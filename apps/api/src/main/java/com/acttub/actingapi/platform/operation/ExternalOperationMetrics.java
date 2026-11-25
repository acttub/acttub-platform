package com.acttub.actingapi.platform.operation;

import static com.acttub.actingapi.platform.persistence.NativeTuples.list;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import com.acttub.actingapi.platform.observability.MonitoringFailures;
import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Tuple;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 옛 원장({@code external_operations})의 상태 표본을 게이지로 낸다. 표에 남은 대기·실행 행의 수와 가장 오래된 시각이다.
 *
 * <p>옛 큐 워커와 함께 접수·시도·외부 호출·재큐·종료 카운터와 대기·실행·경과 histogram 을 지웠다(SOMA-1140). 옛 표를
 * 지울 때까지 이 표본은 남는다 — 대시보드와 경고 규칙이 읽는다.
 */
@Component
public class ExternalOperationMetrics {
    static final List<String> KINDS = List.of("analyze", "coach_start", "coach_reply", "report");
    private static final String PREFIX = "acttub.external.operations.";
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
            for (String waiting : List.of("initial", "retry")) {
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

    private record Snapshot(Map<String, State> states, double timestamp, boolean success) { }
    private record State(long count, long unmeasured, double oldestAge, double oldestWait, double oldestExecution) {
        private static final State EMPTY = new State(0, 0, 0, 0, 0);
    }
}
