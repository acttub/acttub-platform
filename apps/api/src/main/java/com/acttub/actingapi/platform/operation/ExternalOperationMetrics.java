package com.acttub.actingapi.platform.operation;

import static com.acttub.actingapi.platform.persistence.NativeTuples.list;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.TimeUnit;

import com.acttub.actingapi.platform.ledger.ExternalOperationExecution;
import com.acttub.actingapi.platform.ledger.ExternalOperationMonitoring;
import com.acttub.actingapi.platform.observability.MonitoringFailures;
import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Tuple;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionTemplate;

/** Commit counters and a JPA snapshot; historical rows never become counter events. */
@Component
public class ExternalOperationMetrics implements ExternalOperationMonitoring {
    static final List<String> KINDS = List.of("analyze", "coach_start", "coach_reply", "report");
    private static final String PREFIX = "acttub.external.operations.";
    private static final Duration[] DURATION_BUCKETS = {
        Duration.ofMillis(10), Duration.ofMillis(100), Duration.ofMillis(500),
        Duration.ofSeconds(1), Duration.ofSeconds(2), Duration.ofSeconds(5), Duration.ofSeconds(10),
        Duration.ofSeconds(30), Duration.ofMinutes(1), Duration.ofMinutes(2), Duration.ofMinutes(3),
        Duration.ofMinutes(5), Duration.ofMinutes(10), Duration.ofMinutes(30), Duration.ofHours(1)
    };
    private final MeterRegistry registry;
    private final EntityManager entityManager;
    private final Clock clock;
    private final TransactionTemplate transaction;
    private final MonitoringFailures failures;
    private volatile Snapshot snapshot = new Snapshot(Map.of(), 0, false);

    public ExternalOperationMetrics(MeterRegistry registry, EntityManager entityManager, Clock clock,
            PlatformTransactionManager transactionManager, MonitoringFailures failures) {
        this.registry = registry;
        this.entityManager = entityManager;
        this.clock = clock;
        this.failures = failures;
        this.transaction = new TransactionTemplate(transactionManager);
        this.transaction.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        this.transaction.setTimeout(2);
        for (String kind : KINDS) {
            for (String dependency : List.of("storage", "observation", "speech", "model")) {
                registry.counter(PREFIX + "external.calls", "kind", kind, "dependency", dependency);
            }
            for (String event : List.of("accepted", "attempts", "requeues")) {
                registry.counter(PREFIX + event, "kind", kind);
            }
            registry.counter(PREFIX + "terminal", "kind", kind, "outcome", "succeeded", "classification", "none");
            for (String classification : List.of("expected", "external", "unexpected", "unclassified")) {
                registry.counter(PREFIX + "terminal", "kind", kind, "outcome", "failed", "classification", classification);
            }
            for (String outcome : List.of("succeeded", "failed")) {
                Timer.builder(PREFIX + "elapsed").tags("kind", kind, "outcome", outcome)
                        .serviceLevelObjectives(DURATION_BUCKETS).register(registry);
            }
            for (String outcome : List.of("succeeded", "failed", "requeued")) {
                Timer.builder(PREFIX + "execution").tags("kind", kind, "outcome", outcome)
                        .serviceLevelObjectives(DURATION_BUCKETS).register(registry);
            }
            for (String waiting : List.of("initial", "retry")) {
                Timer.builder(PREFIX + "wait").tags("kind", kind, "waiting", waiting)
                        .serviceLevelObjectives(DURATION_BUCKETS).register(registry);
                registerState(kind, "pending", waiting);
                Gauge.builder(PREFIX + "oldest.wait.seconds", this,
                                self -> self.state(kind, "pending", waiting).oldestWait())
                        .tags("kind", kind, "waiting", waiting).register(registry);
            }
            registerState(kind, "running", "none");
            Gauge.builder(PREFIX + "oldest.running.age.seconds", this,
                            self -> self.state(kind, "running", "none").oldestExecution())
                    .tag("kind", kind).register(registry);
            Gauge.builder(PREFIX + "oldest.unfinished.age.seconds", this,
                            self -> Math.max(self.state(kind, "running", "none").oldestAge(),
                                    Math.max(self.state(kind, "pending", "initial").oldestAge(),
                                            self.state(kind, "pending", "retry").oldestAge())))
                    .tag("kind", kind).register(registry);
        }
        Gauge.builder(PREFIX + "snapshot.success", this, self -> self.snapshot.success() ? 1 : 0).register(registry);
        Gauge.builder(PREFIX + "snapshot.timestamp.seconds", this, self -> self.snapshot.timestamp()).register(registry);
    }

    private void registerState(String kind, String state, String waiting) {
        Gauge.builder(PREFIX + "current", this, self -> self.state(kind, state, waiting).count())
                .tags("kind", kind, "state", state, "waiting", waiting).register(registry);
        Gauge.builder(PREFIX + "unmeasured", this, self -> self.state(kind, state, waiting).unmeasured())
                .tags("kind", kind, "state", state, "waiting", waiting).register(registry);
    }

    private State state(String kind, String state, String waiting) {
        return snapshot.states().getOrDefault(kind + ":" + state + ":" + waiting, State.EMPTY);
    }

    @Override
    public void accepted(String kind) {
        if (KINDS.contains(kind)) {
            afterCommit(() -> registry.counter(PREFIX + "accepted", "kind", kind).increment());
        }
    }

    @Override
    public ExternalOperationExecution execution(UUID operationId, UUID leaseToken) {
        var kind = new java.util.concurrent.atomic.AtomicReference<String>();
        return new ExternalOperationExecution(operationId, () -> {
            kind.set(startExecution(operationId, leaseToken));
            return kind.get() != null;
        }, dependency -> {
            if (List.of("storage", "observation", "speech", "model").contains(dependency)) {
                try {
                    registry.counter(PREFIX + "external.calls", "kind", kind.get(), "dependency", dependency).increment();
                } catch (RuntimeException failure) {
                    failures.report(failure, "ExternalOperationMetrics.externalCall");
                }
            }
        }, this::observedNanoTime);
    }

    private Long observedNanoTime() {
        try {
            return registry.config().clock().monotonicTime();
        } catch (RuntimeException failure) {
            failures.report(failure, "ExternalOperationMetrics.executionTime");
            return null;
        }
    }

    private String startExecution(UUID operationId, UUID leaseToken) {
        try {
            return transaction.execute(status -> {
                var rows = list(entityManager.createNativeQuery("""
                        WITH started AS (
                            UPDATE external_operations SET execution_started_at = :startedAt,
                                monitoring_updated_at = updated_at, monitoring_lease_token = lease_token
                            WHERE id = :operationId AND status = 'running' AND lease_token = :leaseToken
                              AND kind IN ('analyze', 'coach_start', 'coach_reply', 'report')
                              AND (execution_started_at IS NULL OR monitoring_lease_token IS DISTINCT FROM lease_token
                                   OR monitoring_updated_at IS DISTINCT FROM updated_at)
                            RETURNING kind
                        ) SELECT kind FROM started
                        """, Tuple.class)
                        .setParameter("startedAt", clock.instant().atOffset(ZoneOffset.UTC))
                        .setParameter("operationId", operationId).setParameter("leaseToken", leaseToken));
                if (rows.isEmpty()) {
                    return null;
                }
                String kind = rows.getFirst().get("kind", String.class);
                afterCommit(() -> registry.counter(PREFIX + "attempts", "kind", kind).increment());
                return kind;
            });
        } catch (RuntimeException failure) {
            // Observation failure cannot prevent the original external call or replace its failure.
            failures.report(failure, "ExternalOperationMetrics.startExecution");
            return null;
        }
    }

    @Override
    public void claimed(Claimed claimed) {
        afterCommit(() -> {
            if (!KINDS.contains(claimed.kind()) || claimed.waitingSince() == null
                    || claimed.waitingSince().isAfter(claimed.claimedAt())) return;
            String waiting = claimed.attemptCount() == 1 ? "initial" : "retry";
            Duration duration = Duration.between(claimed.waitingSince(), claimed.claimedAt());
            registry.timer(PREFIX + "wait", "kind", claimed.kind(), "waiting", waiting).record(duration);
        });
    }

    @Override
    public void requeued(UUID operationId, String kind) {
        Long nanos = elapsedNanos(operationId);
        afterCommit(() -> {
            if (!KINDS.contains(kind)) return;
            registry.counter(PREFIX + "requeues", "kind", kind).increment();
            recordExecution(kind, "requeued", nanos);
        });
    }

    @Override
    public void terminal(Terminal terminal) {
        Long nanos = elapsedNanos(terminal.operationId());
        Instant endedAt = observedNow();
        afterCommit(() -> {
            String kind = terminal.kind();
            String outcome = terminal.outcome();
            if (!KINDS.contains(kind) || !("succeeded".equals(outcome) || "failed".equals(outcome))) return;
            String stored = terminal.classification();
            String classification = "succeeded".equals(outcome) ? "none" : stored == null ? "unclassified" : stored;
            registry.counter(PREFIX + "terminal", "kind", kind, "outcome", outcome,
                    "classification", classification).increment();
            if (endedAt != null) {
                Duration elapsed = Duration.between(terminal.createdAt(), endedAt);
                if (!elapsed.isNegative()) registry.timer(PREFIX + "elapsed", "kind", kind, "outcome", outcome).record(elapsed);
            }
            recordExecution(kind, outcome, nanos);
        });
    }

    private Long elapsedNanos(UUID operationId) {
        try {
            return ExternalOperationExecution.elapsedNanos(operationId);
        } catch (RuntimeException failure) {
            failures.report(failure, "ExternalOperationMetrics.executionTime");
            return null;
        }
    }

    private Instant observedNow() {
        try {
            return clock.instant();
        } catch (RuntimeException failure) {
            failures.report(failure, "ExternalOperationMetrics.terminalTime");
            return null;
        }
    }

    private void recordExecution(String kind, String outcome, Long nanos) {
        if (nanos != null) {
            registry.timer(PREFIX + "execution", "kind", kind, "outcome", outcome).record(nanos, TimeUnit.NANOSECONDS);
        }
    }

    // Internal refresh is independent of the 30s Prometheus scrape and 60s Cloud evaluation.
    // Fixed-delay budget: 5s refresh + 2s DB query + 30s scrape + 60s evaluation
    // + 10s PDC query + 10s notification grouping = 117s, before transport overhead.
    // One bounded aggregate per execution; fixed delay allows at most 12 queries/minute by default.
    @Scheduled(fixedDelayString = "${EXTERNAL_OPERATION_SNAPSHOT_MS:5000}")
    public void refreshSnapshot() {
        try {
            Snapshot fresh = transaction.execute(status -> {
                Instant now = clock.instant();
                var rows = list(entityManager.createNativeQuery("""
                        WITH current_operations AS (
                            SELECT kind, status,
                                CASE WHEN status = 'running' THEN 'none'
                                     WHEN attempt_count = 0 THEN 'initial' ELSE 'retry' END AS waiting,
                                created_at,
                                CASE WHEN status = 'pending' AND attempt_count = 0 THEN created_at
                                     WHEN status = 'pending' AND monitoring_updated_at = updated_at
                                          THEN waiting_since END AS measured_wait,
                                CASE WHEN status = 'running' AND monitoring_updated_at = updated_at
                                          AND monitoring_lease_token = lease_token
                                     THEN execution_started_at END AS measured_execution
                            FROM external_operations
                            WHERE kind IN ('analyze', 'coach_start', 'coach_reply', 'report')
                              AND status IN ('pending', 'running')
                        )
                        SELECT kind, status, waiting, count(*) AS count, min(created_at) AS created_at,
                            min(measured_wait) AS waiting_since, min(measured_execution) AS execution_started_at,
                            count(*) FILTER (WHERE (status = 'pending' AND measured_wait IS NULL)
                                OR (status = 'running' AND measured_execution IS NULL)) AS unmeasured
                        FROM current_operations GROUP BY kind, status, waiting
                        """, Tuple.class).setHint("jakarta.persistence.query.timeout", 2000));
                Map<String, State> states = new HashMap<>();
                for (Tuple row : rows) {
                    states.put(row.get("kind") + ":" + row.get("status") + ":" + row.get("waiting"),
                            new State(((Number) row.get("count")).longValue(),
                                    ((Number) row.get("unmeasured")).longValue(),
                                    age(row.get("created_at", Instant.class), now),
                                    age(row.get("waiting_since", Instant.class), now),
                                    age(row.get("execution_started_at", Instant.class), now)));
                }
                return new Snapshot(Map.copyOf(states), now.toEpochMilli() / 1000d, true);
            });
            if (fresh != null) {
                snapshot = fresh;
            }
        } catch (RuntimeException failure) {
            Snapshot previous = snapshot;
            snapshot = new Snapshot(previous.states(), previous.timestamp(), false);
            failures.report(failure, "ExternalOperationMetrics.snapshot");
        }
    }

    private static double age(Instant since, Instant now) {
        return since == null ? 0 : Math.max(0, Duration.between(since, now).toMillis() / 1000d);
    }

    private void afterCommit(Runnable observation) {
        try {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    try {
                        observation.run();
                    } catch (RuntimeException failure) {
                        failures.report(failure, "ExternalOperationMetrics.afterCommit");
                    }
                }
            });
        } catch (RuntimeException failure) {
            failures.report(failure, "ExternalOperationMetrics.registration");
        }
    }

    private record Snapshot(Map<String, State> states, double timestamp, boolean success) { }
    private record State(long count, long unmeasured, double oldestAge, double oldestWait, double oldestExecution) {
        private static final State EMPTY = new State(0, 0, 0, 0, 0);
    }
}
