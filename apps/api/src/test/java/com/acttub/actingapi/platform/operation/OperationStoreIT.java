package com.acttub.actingapi.platform.operation;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.TreeSet;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.function.Supplier;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import com.acttub.actingapi.feature.auth.app.AccountErasureStep;
import com.acttub.actingapi.feature.auth.app.ClosingAccount;
import com.acttub.actingapi.platform.ledger.AiJobLedger;
import com.acttub.actingapi.platform.ledger.LeaseOwnershipException;
import com.acttub.actingapi.platform.observability.DatabaseHealthIndicator;
import com.acttub.actingapi.support.PostgresContainerSupport;
import io.micrometer.core.instrument.MeterRegistry;
import org.hibernate.resource.jdbc.spi.StatementInspector;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.health.contributor.Status;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionStatus;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 작업 장부({@code ai_jobs})와 옛 원장({@code external_operations})을 고치는 platform/operation 문장의 결과·잠금·경합·문장 수를
 * 실제 PostgreSQL 에서 고정한다 — 선점·완료·실패·놓기·정리, 하루 요청 수, 탈퇴의 닫기, 이관의 주인 바꾸기, 상태 표본 게이지, DB 연결
 * 확인. 네이티브 SQL 을 JPA 로 옮기기 전에 네이티브 구현에서 먼저 통과시킨다(apps/api/CONTRACT.md §5-9).
 *
 * <p>lease 계약의 큰 줄기(선점의 배타, 만료된 lease 의 완료, 시도 소진, 넣기의 트랜잭션 참여, 취소)는 {@link AiJobLedgerIT} 가,
 * 낡은 감시 값을 무시하는 게이지는 {@link ExternalOperationSnapshotIT} 가 본다. 여기서는 그 테스트가 밟지 않는 고르는 순서, 시각의
 * 경계와 정밀도, 다시 집기, 잡힌 행 건너뛰기, 사유 칸, 돌려주는 id, 포트 메서드마다 나가는 문장을 본다.
 */
@SpringBootTest(properties = {
    "JWT_SECRET=test-secret",
    "spring.jpa.properties.hibernate.session_factory.statement_inspector="
            + "com.acttub.actingapi.platform.operation.OperationStoreIT$Recorder"
})
// 이 클래스만 쓰는 설정이라 끝나면 닫는다(PosterRepositoryIT 와 같은 까닭).
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class OperationStoreIT {

    /** 이 스레드가 보낸 SQL 을 모은다. 경합 쪽 스레드와 예약 작업의 문장은 섞이지 않는다. */
    public static class Recorder implements StatementInspector {
        private static final ThreadLocal<List<String>> STATEMENTS = ThreadLocal.withInitial(ArrayList::new);

        @Override
        public String inspect(String sql) {
            STATEMENTS.get().add(sql);
            return sql;
        }
    }

    private static final Duration LEASE = Duration.ofMinutes(10);

    @Value("${spring.datasource.url}")
    private String databaseUrl;

    @Autowired
    JdbcTemplate jdbc;

    @Autowired
    PostgresAiJobLedger jobs;

    @Autowired
    ExternalOperationOwnership ownership;

    @Autowired
    PostgresOperationAccountErasure erasure;

    @Autowired
    ExternalOperationMetrics metrics;

    @Autowired
    MeterRegistry meters;

    @Autowired
    DatabaseHealthIndicator health;

    @Autowired
    PlatformTransactionManager transactionManager;

    private final Instant now = Instant.parse("2026-11-27T03:00:00Z");
    private UUID user;
    private UUID other;

    @BeforeEach
    void setUp() {
        jdbc.execute("TRUNCATE TABLE users CASCADE");
        user = user();
        other = user();
        Recorder.STATEMENTS.get().clear();
    }

    // ---- 선점(claimNext) ----

    @Test
    @DisplayName("claimNext 는 그 종류의 대기 작업 가운데 시도가 남은 가장 오래된 것(같으면 id 작은 것)을 집고 시도 수·토큰·시한·고친 시각을 적는다. 기억 세대와 대상도 낸다")
    void claimNextPicksTheOldestPendingJobWithAttemptsLeft() {
        job(id(3), user, "analyze", "pending", 0, now.minusSeconds(60), null);
        job(id(2), user, "analyze", "pending", 1, now.minusSeconds(60), null);
        job(id(1), user, "analyze", "pending", 3, now.minusSeconds(600), null);
        job(id(4), user, "memory_update", "pending", 0, now.minusSeconds(900), null);
        job(id(5), user, "analyze", "running", 0, now.minusSeconds(900), now.minusSeconds(1));
        jdbc.update("UPDATE ai_jobs SET memory_epoch=4, target_id=? WHERE id=?", id(99), id(2));
        UUID token = UUID.randomUUID();

        AiJobLedger.Claimed claimed = jobs.claimNext("analyze", token, LEASE, now.plusNanos(1_500), false);

        assertThat(claimed).isEqualTo(new AiJobLedger.Claimed(id(2), user, id(99), 2, 4));
        assertThat(row(id(2))).isEqualTo("running:2:" + token + ":03:10:00.000002:03:00:00.000002:-");
        assertThat(jobs.claimNext("analyze", UUID.randomUUID(), LEASE, now, false))
                .extracting(AiJobLedger.Claimed::id, AiJobLedger.Claimed::attemptCount, AiJobLedger.Claimed::memoryEpoch)
                .containsExactly(id(3), 1, null);
        assertThat(jobs.claimNext("analyze", UUID.randomUUID(), LEASE, now, false)).as("시도를 다 쓴 것과 실행 중인 것은 집지 않는다").isNull();
    }

    @Test
    @DisplayName("claimNext 는 reclaimExpired 일 때만 lease 가 now 보다 먼저 지난 실행 중 작업을 다시 집는다. now 와 같은 시한과 시도를 다 쓴 것은 집지 않는다")
    void claimNextReclaimsExpiredRunningJobsOnlyWhenAsked() {
        job(id(1), user, "analyze", "running", 1, now.minusSeconds(60), now.minusNanos(1_000));
        job(id(2), user, "analyze", "running", 1, now.minusSeconds(120), now);
        job(id(3), user, "analyze", "running", 3, now.minusSeconds(180), now.minusSeconds(60));

        assertThat(jobs.claimNext("analyze", UUID.randomUUID(), LEASE, now, false)).isNull();
        assertThat(jobs.claimNext("analyze", UUID.randomUUID(), LEASE, now, true))
                .extracting(AiJobLedger.Claimed::id, AiJobLedger.Claimed::attemptCount).containsExactly(id(1), 2);
        assertThat(jobs.claimNext("analyze", UUID.randomUUID(), LEASE, now, true)).isNull();
    }

    @Test
    @DisplayName("claimNext 는 다른 트랜잭션이 FOR KEY SHARE 로라도 잡은 작업을 기다리지 않고 건너뛴다")
    void claimNextSkipsJobsLockedByAnotherTransaction() throws Exception {
        job(id(1), user, "analyze", "pending", 0, now.minusSeconds(60), null);
        job(id(2), user, "analyze", "pending", 0, now.minusSeconds(30), null);
        try (Connection probe = probe()) {
            lock(probe, id(1), "FOR KEY SHARE");
            assertThat(jobs.claimNext("analyze", UUID.randomUUID(), LEASE, now, false).id()).isEqualTo(id(2));
            assertThat(jobs.claimNext("analyze", UUID.randomUUID(), LEASE, now, false)).isNull();
            probe.rollback();
        }
        assertThat(jobs.claimNext("analyze", UUID.randomUUID(), LEASE, now, false).id()).isEqualTo(id(1));
    }

    @Test
    @DisplayName("두 워커가 함께 집으면 뒤의 것은 앞의 것이 잡은 작업을 건너뛰고 다음 것을 집는다")
    void twoWorkersClaimDifferentJobs() throws Exception {
        job(id(1), user, "analyze", "pending", 0, now.minusSeconds(60), null);
        job(id(2), user, "analyze", "pending", 0, now.minusSeconds(30), null);
        Race<AiJobLedger.Claimed> first = new Race<>(() -> jobs.claimNext("analyze", UUID.randomUUID(), LEASE, now, false));
        try {
            Future<AiJobLedger.Claimed> second = first.pool.submit(() ->
                    jobs.claimNext("analyze", UUID.randomUUID(), LEASE, now, false));
            assertThat(second.get(20, TimeUnit.SECONDS).id()).isEqualTo(id(2));
            first.commit();
            assertThat(first.result().id()).isEqualTo(id(1));
        } finally {
            first.pool.shutdownNow();
        }
        assertThat(jdbc.queryForList("SELECT status || ':' || attempt_count FROM ai_jobs ORDER BY id", String.class))
                .containsExactly("running:1", "running:1");
    }

    // ---- 닫기(succeed·fail·release·sweepMaxAttempts·failExpired) ----

    @Test
    @DisplayName("succeed 는 실행 중일 때만 닫고 사유를 비우고 lease 를 뗀다. 이미 끝난 작업과 없는 작업은 거짓이다")
    void succeedClosesOnlyRunningJobs() {
        UUID token = UUID.randomUUID();
        job(id(1), user, "analyze", "running", 1, now.minusSeconds(60), now.plusSeconds(60));
        jdbc.update("UPDATE ai_jobs SET lease_token=?, failure_reason='storage' WHERE id=?", token, id(1));
        job(id(2), user, "analyze", "failed", 1, now.minusSeconds(60), null);

        assertThat(jobs.succeed(id(1), token, now.plusNanos(1_500))).isTrue();
        assertThat(row(id(1))).isEqualTo("succeeded:1:-:-:03:00:00.000002:-");
        assertThat(jobs.succeed(id(1), null, now)).as("끝난 작업").isFalse();
        assertThat(jobs.succeed(id(2), UUID.randomUUID(), now)).isFalse();
        assertThat(jobs.succeed(UUID.randomUUID(), UUID.randomUUID(), now)).as("없는 작업").isFalse();
        assertThat(row(id(2))).isEqualTo("failed:1:-:-:02:59:00.000000:-");
    }

    @Test
    @DisplayName("release 는 남의 토큰이면 거절하고 아무것도 바꾸지 않는다. 실행 중이 아니면 바꾸지 않는다")
    void releaseRejectsAForeignLeaseAndIgnoresNonRunningJobs() {
        UUID token = UUID.randomUUID();
        job(id(1), user, "analyze", "running", 1, now.minusSeconds(60), now.plusSeconds(60));
        jdbc.update("UPDATE ai_jobs SET lease_token=? WHERE id=?", token, id(1));
        job(id(2), user, "analyze", "pending", 1, now.minusSeconds(60), null);

        assertThatThrownBy(() -> jobs.release(id(1), UUID.randomUUID(), "storage", now))
                .isInstanceOf(LeaseOwnershipException.class);
        assertThat(row(id(1))).startsWith("running:1:" + token);
        jobs.release(id(2), null, "storage", now);
        assertThat(row(id(2))).isEqualTo("pending:1:-:-:02:59:00.000000:-");

        jobs.release(id(1), token, "storage", now.plusSeconds(1));
        assertThat(row(id(1))).isEqualTo("pending:1:-:-:03:00:01.000000:storage");
    }

    @Test
    @DisplayName("sweepMaxAttempts 는 시도를 다 쓴 대기 작업만 닫고 남은 사유를 지키며 없으면 max_attempts 를 적는다")
    void sweepMaxAttemptsKeepsTheLastReason() {
        job(id(1), user, "analyze", "pending", 3, now.minusSeconds(60), null);
        job(id(2), user, "memory_update", "pending", 4, now.minusSeconds(60), null);
        jdbc.update("UPDATE ai_jobs SET failure_reason='storage' WHERE id=?", id(2));
        job(id(3), user, "analyze", "pending", 2, now.minusSeconds(60), null);
        job(id(4), user, "analyze", "running", 3, now.minusSeconds(60), now.minusSeconds(1));

        assertThat(jobs.sweepMaxAttempts(now)).isEqualTo(2);
        assertThat(List.of(row(id(1)), row(id(2)), row(id(3)), row(id(4)).substring(0, 9))).containsExactly(
                "failed:3:-:-:03:00:00.000000:max_attempts", "failed:4:-:-:03:00:00.000000:storage",
                "pending:2:-:-:02:59:00.000000:-", "running:3");
    }

    @Test
    @DisplayName("failExpired 는 그 종류의 실행 중 작업 가운데 시도를 다 쓰고 lease 가 now 보다 먼저 지난 것만 닫고 그 id 를 낸다")
    void failExpiredClosesExhaustedExpiredRunningJobs() {
        job(id(1), user, "analyze", "running", 3, now.minusSeconds(600), now.minusNanos(1_000));
        job(id(2), user, "analyze", "running", 3, now.minusSeconds(600), now.minusSeconds(60));
        job(id(3), user, "analyze", "running", 3, now.minusSeconds(600), now);
        job(id(4), user, "analyze", "running", 2, now.minusSeconds(600), now.minusSeconds(60));
        job(id(5), user, "memory_update", "running", 3, now.minusSeconds(600), now.minusSeconds(60));
        job(id(6), user, "analyze", "pending", 3, now.minusSeconds(600), null);

        assertThat(jobs.failExpired("analyze", now)).containsExactlyInAnyOrder(id(1), id(2));
        assertThat(jobs.failExpired("analyze", now)).isEmpty();
        assertThat(row(id(1))).isEqualTo("failed:3:-:-:03:00:00.000000:max_attempts");
        assertThat(jdbc.queryForList("SELECT status FROM ai_jobs WHERE id IN (?,?,?,?) ORDER BY id", String.class,
                id(3), id(4), id(5), id(6))).containsExactly("running", "running", "running", "pending");
    }

    // ---- 하루 요청 수(countRequestedSince) ----

    @Test
    @DisplayName("countRequestedSince 는 그 사람·종류의 작업을 두 장부에서 since 부터(같은 시각 포함) 센다")
    void countRequestedSinceCountsBothLedgers() {
        job(id(1), user, "analyze", "failed", 1, now.minusSeconds(1), null);
        job(id(2), user, "analyze", "pending", 0, now.minusSeconds(60), null);
        job(id(3), user, "analyze", "pending", 0, now.minusSeconds(61), null);
        job(id(4), user, "memory_update", "pending", 0, now, null);
        job(id(5), other, "analyze", "pending", 0, now, null);
        operation(user, "analyze", "succeeded", now.minusSeconds(60));
        operation(user, "analyze", "pending", now.minusSeconds(61));
        operation(user, "report", "pending", now);

        assertThat(jobs.countRequestedSince(user, "analyze", now.minusSeconds(60))).isEqualTo(3);
        assertThat(jobs.countRequestedSince(user, "memory_update", now)).isEqualTo(1);
        assertThat(jobs.countRequestedSince(user, "report", now.minusSeconds(1))).isEqualTo(1);
        assertThat(jobs.countRequestedSince(user, "analyze", now.plusSeconds(1))).isZero();
    }

    // ---- 탈퇴(PostgresOperationAccountErasure) ----

    @Test
    @DisplayName("탈퇴는 그 사람의 대기·실행 중 작업을 account_deactivated 로 닫고 lease 와 결과를 비운다. 끝난 작업과 다른 사람의 작업은 그대로다")
    void accountErasureClosesUnfinishedJobs() {
        job(id(1), user, "analyze", "pending", 0, now.minusSeconds(60), null);
        job(id(2), user, "memory_update", "running", 1, now.minusSeconds(60), now.plusSeconds(60));
        job(id(3), user, "analyze", "succeeded", 1, now.minusSeconds(60), null);
        job(id(4), other, "analyze", "pending", 0, now.minusSeconds(60), null);
        jdbc.update("UPDATE ai_jobs SET result='{\"k\":1}'::jsonb, lease_token=? WHERE id IN (?,?,?)", UUID.randomUUID(),
                id(2), id(3), id(4));

        new TransactionTemplate(transactionManager).executeWithoutResult(tx ->
                erasure.erase(AccountErasureStep.AI_JOBS, closing(user, now.plusNanos(1_500))));

        assertThat(List.of(row(id(1)), row(id(2)))).containsExactly("failed:0:-:-:03:00:00.000002:account_deactivated",
                "failed:1:-:-:03:00:00.000002:account_deactivated");
        assertThat(jdbc.queryForList("SELECT (result IS NULL) || ':' || status FROM ai_jobs ORDER BY id", String.class))
                .containsExactly("true:failed", "true:failed", "false:succeeded", "false:pending");
    }

    // ---- 이관(ExternalOperationOwnership) ----

    @Test
    @DisplayName("이관의 reassign 은 두 장부에서 그 사람의 행을 모두 회원에게 옮긴다. 부르는 쪽의 트랜잭션이 없으면 거절한다")
    void reassignMovesBothLedgers() {
        job(id(1), user, "analyze", "running", 1, now, now.plusSeconds(60));
        job(id(2), other, "analyze", "pending", 0, now, null);
        operation(user, "analyze", "pending", now);
        UUID member = user();

        assertThatThrownBy(() -> ownership.reassign(user, member)).isInstanceOf(RuntimeException.class);
        new TransactionTemplate(transactionManager).executeWithoutResult(tx -> ownership.reassign(user, member));

        assertThat(jdbc.queryForList("SELECT user_id FROM ai_jobs ORDER BY id", UUID.class)).containsExactly(member, other);
        assertThat(jdbc.queryForObject("SELECT user_id FROM external_operations", UUID.class)).isEqualTo(member);
        assertThat(row(id(1))).as("상태와 lease 는 그대로다").startsWith("running:1:");
    }

    // ---- 상태 표본(ExternalOperationMetrics)·연결 확인(DatabaseHealthIndicator) ----

    @Test
    @DisplayName("상태 표본은 네 종류의 대기·실행 중 행을 종류·상태·처음인지 다시인지로 센다. 끝난 행과 다른 종류는 세지 않고, 처음 대기는 만든 시각에서 잰다")
    void snapshotCountsCurrentOperations() {
        operation(user, "analyze", "pending", Instant.now().minusSeconds(300));
        operation(user, "analyze", "pending", Instant.now().minusSeconds(100));
        UUID retried = operation(user, "analyze", "pending", Instant.now().minusSeconds(200));
        jdbc.update("UPDATE external_operations SET attempt_count=1 WHERE id=?", retried);
        operation(user, "report", "running", Instant.now().minusSeconds(50));
        operation(user, "coach_reply", "succeeded", Instant.now().minusSeconds(50));
        operation(user, "memory_update", "pending", Instant.now().minusSeconds(900));

        // 예약된 표본이 함께 돌다 앞선 표본으로 덮을 수 있어 부르고 읽기를 맞을 때까지 되풀이한다.
        org.awaitility.Awaitility.await().atMost(Duration.ofSeconds(5)).untilAsserted(() -> {
        metrics.refreshSnapshot();
        assertThat(gauge("current", "analyze", "pending", "initial")).isEqualTo(2);
        assertThat(gauge("current", "analyze", "pending", "retry")).isEqualTo(1);
        assertThat(gauge("unmeasured", "analyze", "pending", "retry")).as("다시 대기는 감시 값이 없어 잴 수 없다").isEqualTo(1);
        assertThat(gauge("unmeasured", "analyze", "pending", "initial")).isZero();
        assertThat(gauge("current", "report", "running", "none")).isEqualTo(1);
        assertThat(gauge("current", "coach_reply", "running", "none")).isZero();
        assertThat(meters.get("acttub.external.operations.oldest.wait.seconds").tags("kind", "analyze", "waiting", "initial")
                .gauge().value()).isBetween(299.0, 330.0);
        assertThat(meters.get("acttub.external.operations.oldest.unfinished.age.seconds").tag("kind", "analyze")
                .gauge().value()).isBetween(299.0, 330.0);
        assertThat(meters.get("acttub.external.operations.snapshot.success").gauge().value()).isEqualTo(1);
        });
    }

    @Test
    @DisplayName("DB 연결 확인은 한 문장으로 UP 을 낸다")
    void healthIsUp() {
        assertThat(health.health().getStatus()).isEqualTo(Status.UP);
    }

    // ---- 문장 ----

    @Test
    @DisplayName("포트 메서드마다 나가는 문장의 수와 종류")
    void eachPortMethodSendsTheseStatements() {
        job(id(1), user, "analyze", "pending", 0, now.minusSeconds(60), null);
        UUID token = UUID.randomUUID();
        assertThat(statementsOf(() -> jobs.claimNext("analyze", token, LEASE, now, true)))
                .as("집을 것이 있으면 잠가 읽기와 임대 적기 두 문장이다(native 는 데이터를 바꾸는 CTE 한 문장이었다)")
                .containsExactly("select ai_jobs skip locked", "update ai_jobs");
        assertThat(statementsOf(() -> jobs.claimNext("analyze", UUID.randomUUID(), LEASE, now, false)))
                .as("집을 것이 없으면 한 문장이다").containsExactly("select ai_jobs skip locked");
        assertThat(statementsOf(() -> jobs.succeed(id(1), token, now)))
                .containsExactly("select ai_jobs", "update ai_jobs");
        assertThat(statementsOf(() -> jobs.fail(id(1), token, "timeout", now)))
                .containsExactly("select ai_jobs", "update ai_jobs");
        assertThat(statementsOf(() -> {
            jobs.release(id(1), token, "storage", now);
            return null;
        })).containsExactly("select ai_jobs", "update ai_jobs");
        assertThat(statementsOf(() -> jobs.sweepMaxAttempts(now))).containsExactly("update ai_jobs");
        assertThat(statementsOf(() -> jobs.failExpired("analyze", now)))
                .as("닫을 것이 없으면 잠가 읽기 한 문장이다(native 는 UPDATE … RETURNING 한 문장이었다)")
                .containsExactly("select ai_jobs for update");
        job(id(2), user, "analyze", "running", 3, now.minusSeconds(600), now.minusSeconds(60));
        assertThat(statementsOf(() -> jobs.failExpired("analyze", now)))
                .as("닫을 것이 있으면 잠가 읽고 그 id 로 닫는다").containsExactly("select ai_jobs for update", "update ai_jobs");
        assertThat(statementsOf(() -> jobs.countRequestedSince(user, "analyze", now)))
                .containsExactly("select ai_jobs external_operations");
        assertThat(statementsOf(() -> new TransactionTemplate(transactionManager).execute(tx ->
                jobs.enqueue(user, "analyze", UUID.randomUUID(), UUID.randomUUID(), "f".repeat(64), now))))
                .containsExactly("insert ai_jobs");
        assertThat(statementsOf(() -> new TransactionTemplate(transactionManager).execute(tx ->
                jobs.cancel("analyze", UUID.randomUUID(), now)))).containsExactly("update ai_jobs");
        assertThat(statementsOf(() -> new TransactionTemplate(transactionManager).execute(tx ->
                erasure.erase(AccountErasureStep.AI_JOBS, closing(other, now))))).containsExactly("update ai_jobs");
        assertThat(statementsOf(() -> new TransactionTemplate(transactionManager).execute(tx -> {
            ownership.reassign(other, user);
            return null;
        }))).containsExactly("update external_operations", "update ai_jobs");
        assertThat(statementsOf(() -> {
            metrics.refreshSnapshot();
            return null;
        })).containsExactly("select external_operations");
        assertThat(statementsOf(() -> health.health())).as("연결 확인은 다른 스레드에서 돈다").isEmpty();
    }

    // ---- 도움 ----

    private static final Pattern KIND = Pattern.compile(
            "^(?:with \\w+(?: ?\\([^)]*\\))? as (?:(?:not )?materialized )?\\( ?)?(select|insert|update|delete)\\b.*");
    private static final Pattern TABLE = Pattern.compile("\\b(?:from|join|into|update) (?!(?:set|skip|of|nowait)\\b)(\\w+)\\b");
    private static final Pattern UPDATE_IN_CTE = Pattern.compile("^with \\w+ .*\\) update .*");

    /**
     * 문장을 "<종류> <문장에 나오는 표(가나다 순)>[ skip locked| for update][ returning]" 으로 줄인다. 데이터를 바꾸는 CTE 는 그 문장의 종류로 보고
     * CTE 이름은 표로 세지 않는다. 별칭·열 목록·매개변수 표기는 두 구현이 달라 견주지 않는다.
     */
    static String label(String sql) {
        String text = sql.strip().replaceAll("\\s+", " ").toLowerCase(Locale.ROOT);
        Matcher kind = KIND.matcher(text);
        if (!kind.matches()) {
            return text;
        }
        String verb = UPDATE_IN_CTE.matcher(text).matches() ? "update" : kind.group(1);
        Matcher cte = Pattern.compile("^with (\\w+)\\b").matcher(text);
        String cteName = cte.find() ? cte.group(1) : null;
        TreeSet<String> tables = new TreeSet<>();
        Matcher table = TABLE.matcher(text);
        while (table.find()) {
            if (!table.group(1).equals(cteName)) {
                tables.add(table.group(1));
            }
        }
        String lock = text.contains(" skip locked") ? " skip locked" : text.contains(" for update") ? " for update" : "";
        return verb + " " + String.join(" ", tables) + lock + (text.contains(" returning ") ? " returning" : "");
    }

    private List<String> statementsOf(Supplier<?> call) {
        Recorder.STATEMENTS.get().clear();
        call.get();
        List<String> sent = Recorder.STATEMENTS.get().stream().map(OperationStoreIT::label).toList();
        Recorder.STATEMENTS.get().clear();
        return sent;
    }

    /** 첫 요청: 트랜잭션 안에서 포트를 부르고, 커밋하거나 되돌릴 때까지 열어 둔다. */
    private final class Race<T> {
        final ExecutorService pool = Executors.newFixedThreadPool(2);
        private final CountDownLatch done = new CountDownLatch(1);
        private final CountDownLatch release = new CountDownLatch(1);
        private final Future<T> result;

        Race(Supplier<T> call) {
            TransactionTemplate transaction = new TransactionTemplate(transactionManager);
            result = pool.submit(() -> transaction.execute((TransactionStatus tx) -> {
                T value = call.get();
                done.countDown();
                await(release);
                return value;
            }));
            await(done);
        }

        void commit() {
            release.countDown();
        }

        T result() throws Exception {
            return result.get(20, TimeUnit.SECONDS);
        }
    }

    /** 상태:시도:토큰:시한(시각만):고친 시각(시각만):사유. 비어 있으면 {@code -}. */
    private String row(UUID id) {
        return jdbc.queryForObject("""
                SELECT status || ':' || attempt_count || ':' || coalesce(CAST(lease_token AS text), '-') || ':'
                       || coalesce(to_char(lease_expires_at AT TIME ZONE 'UTC', 'HH24:MI:SS.US'), '-') || ':'
                       || to_char(updated_at AT TIME ZONE 'UTC', 'HH24:MI:SS.US') || ':' || coalesce(failure_reason, '-')
                  FROM ai_jobs WHERE id=?
                """, String.class, id);
    }

    private double gauge(String name, String kind, String state, String waiting) {
        return meters.get("acttub.external.operations." + name).tags("kind", kind, "state", state, "waiting", waiting)
                .gauge().value();
    }

    private static ClosingAccount closing(UUID userId, Instant at) {
        return new ClosingAccount(userId, false, at, LocalDate.ofInstant(at, ZoneOffset.UTC));
    }

    private UUID user() {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO users(id,status) VALUES (?,'active')", id);
        return id;
    }

    private void job(UUID id, UUID userId, String kind, String status, int attempts, Instant createdAt,
            Instant leaseExpiresAt) {
        jdbc.update("""
                INSERT INTO ai_jobs(id,user_id,kind,target_id,request_id,request_fingerprint,status,attempt_count,
                                    lease_token,lease_expires_at,created_at,updated_at)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
                """, id, userId, kind, UUID.randomUUID(), UUID.randomUUID(), "f".repeat(64), status, attempts,
                leaseExpiresAt == null ? null : UUID.randomUUID(), timestamp(leaseExpiresAt), timestamp(createdAt),
                timestamp(createdAt));
    }

    private UUID operation(UUID userId, String kind, String status, Instant createdAt) {
        UUID upload = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO upload_intents(id,user_id,status,storage_provider,object_key,mime_type,size_bytes,expires_at)
                VALUES (?,?,'finalized','s3',?,'video/mp4',1,now())
                """, upload, userId, "uploads/" + upload + ".mp4");
        UUID session = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO practice_sessions(id,user_id,upload_intent_id,status,situation,character_context,blockage_kind,
                                              sub_branch,goal)
                VALUES (?,?,?,'analyzing','상황','인물','분석','캐릭터 분석','목표')
                """, session, userId, upload);
        UUID id = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO external_operations(id,session_id,user_id,request_id,kind,status,request_fingerprint,created_at)
                VALUES (?,?,?,?,?,?,?,?)
                """, id, session, userId, UUID.randomUUID(), kind, status, "a".repeat(64), timestamp(createdAt));
        return id;
    }

    private static OffsetDateTime timestamp(Instant value) {
        return value == null ? null : value.atOffset(ZoneOffset.UTC);
    }

    private static UUID id(int n) {
        return UUID.fromString("00000000-0000-0000-0000-%012d".formatted(n));
    }

    private Connection probe() throws SQLException {
        Connection probe = DriverManager.getConnection(databaseUrl,
                PostgresContainerSupport.POSTGRES.getUsername(), PostgresContainerSupport.POSTGRES.getPassword());
        probe.setAutoCommit(false);
        return probe;
    }

    private static void lock(Connection probe, UUID id, String strength) throws SQLException {
        try (PreparedStatement statement = probe.prepareStatement("SELECT 1 FROM ai_jobs WHERE id=? " + strength)) {
            statement.setObject(1, id);
            statement.execute();
        }
    }

    private static void await(CountDownLatch latch) {
        try {
            assertThat(latch.await(20, TimeUnit.SECONDS)).isTrue();
        } catch (InterruptedException exc) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException(exc);
        }
    }
}
