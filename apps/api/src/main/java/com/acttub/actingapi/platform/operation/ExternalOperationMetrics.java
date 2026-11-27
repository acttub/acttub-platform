package com.acttub.actingapi.platform.operation;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import com.acttub.actingapi.platform.observability.MonitoringFailures;
import com.acttub.actingapi.platform.schema.OperationKind;
import com.acttub.actingapi.platform.schema.OperationStatus;
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
                // 종류·상태 칸은 변환기가 붙은 enum 이라 상수 이름으로 견주고, 표본의 열쇠는 DB 값으로 만든다.
                var rows = entityManager.createQuery("""
                        with current_operations as (
                            select o.kind as kind, o.status as status,
                                case when o.status = RUNNING then 'none'
                                     when o.attemptCount = 0 then 'initial' else 'retry' end as waiting,
                                o.createdAt as createdAt,
                                case when o.status = PENDING and o.attemptCount = 0 then o.createdAt
                                     when o.status = PENDING and o.monitoringUpdatedAt = o.updatedAt
                                          then o.waitingSince end as measuredWait,
                                case when o.status = RUNNING and o.monitoringUpdatedAt = o.updatedAt
                                          and o.monitoringLeaseToken = o.leaseToken
                                     then o.executionStartedAt end as measuredExecution
                            from ExternalOperationEntity o
                            where o.kind in (ANALYZE, COACH_START, COACH_REPLY, REPORT)
                              and o.status in (PENDING, RUNNING)
                        )
                        select c.kind as kind, c.status as status, c.waiting as waiting, count(*) as count,
                            min(c.createdAt) as createdAt, min(c.measuredWait) as waitingSince,
                            min(c.measuredExecution) as executionStartedAt,
                            count(*) filter (where (c.status = PENDING and c.measuredWait is null)
                                or (c.status = RUNNING and c.measuredExecution is null)) as unmeasured
                        from current_operations c group by c.kind, c.status, c.waiting
                        """, Tuple.class).setHint("jakarta.persistence.query.timeout", 2000).getResultList();
                Map<String, State> states = new HashMap<>();
                for (Tuple row : rows) {
                    states.put(row.get("kind", OperationKind.class).dbValue() + ":"
                                    + row.get("status", OperationStatus.class).dbValue() + ":" + row.get("waiting"),
                            new State(((Number) row.get("count")).longValue(),
                                    ((Number) row.get("unmeasured")).longValue(),
                                    age(row.get("createdAt", Instant.class), now),
                                    age(row.get("waitingSince", Instant.class), now),
                                    age(row.get("executionStartedAt", Instant.class), now)));
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
