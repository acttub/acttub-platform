package com.acttub.actingapi.platform.operation;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Map;
import java.util.UUID;

import com.acttub.actingapi.platform.ledger.AiJobLedger;
import com.acttub.actingapi.platform.ledger.LeaseOwnershipException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * {@code ai_jobs} 장부의 lease 상태 전이 (practice.analyze). <b>{@code external_operations} 와 같은 고정 계약</b>
 * 이어야 한다(CONTRACT §5-7) — 두 원장이 공존하는 동안 분석의 재시도 횟수와 최종 사유가 달라지면 안 된다.
 * 옛 원장 쪽 같은 계약은 {@code platform/operation/ExternalOperationIT} 가 지킨다.
 */
@SpringBootTest(properties = "JWT_SECRET=test-secret")
class AiJobLedgerIT {
    private static final Duration LEASE = Duration.ofMinutes(10);

    @Autowired
    AiJobLedger jobs;

    @Autowired
    JdbcTemplate jdbc;

    @Autowired
    TransactionTemplate transaction;

    private UUID user;
    private Instant now;

    @BeforeEach
    void setUp() {
        jdbc.execute("TRUNCATE TABLE users RESTART IDENTITY CASCADE");
        user = UUID.randomUUID();
        jdbc.update("INSERT INTO users(id,status) VALUES (?,'active')", user);
        now = Instant.now().truncatedTo(java.time.temporal.ChronoUnit.SECONDS);
    }

    @Test
    @DisplayName("practice.analyze: 대기 중인 작업을 선점 — 상태가 running 이고 시도 수가 하나 늘며 토큰·시한이 박힌다. 두 워커가 같은 작업을 함께 집지 못한다")
    void aiJobs_claimingMarksTheJobRunningAndIsExclusive() {
        UUID job = seed("analyze", "pending", 0);

        AiJobLedger.Claimed claimed = jobs.claimNext("analyze", UUID.randomUUID(), LEASE, now);

        assertThat(claimed).isNotNull();
        assertThat(claimed.id()).isEqualTo(job);
        assertThat(claimed.userId()).isEqualTo(user);
        assertThat(claimed.attemptCount()).isEqualTo(1);
        assertThat(jdbc.queryForMap("SELECT status,lease_token,lease_expires_at FROM ai_jobs WHERE id=?", job))
                .containsEntry("status", "running");
        assertThat(jobs.claimNext("analyze", UUID.randomUUID(), LEASE, now))
                .as("이미 집힌 작업은 다시 집히지 않는다").isNull();
        assertThat(jobs.claimNext("memory_update", UUID.randomUUID(), LEASE, now))
                .as("종류가 다르면 집지 않는다").isNull();
    }

    @Test
    @DisplayName("practice.analyze: lease 가 만료됐어도 아직 재선점되지 않았으면 완료를 받는다. 다른 워커가 재선점한 뒤의 완료는 거절하고 되돌린다")
    void aiJobs_expiredLeaseStillCompletesUnlessSomeoneElseClaimedIt() {
        UUID job = seed("analyze", "pending", 0);
        UUID first = UUID.randomUUID();
        jobs.claimNext("analyze", first, LEASE, now);
        jdbc.update("UPDATE ai_jobs SET lease_expires_at=? WHERE id=?", at(now.minusSeconds(60)), job);

        assertThat(jobs.succeed(job, first, now)).as("만료됐지만 아무도 재선점하지 않았다").isTrue();
        assertThat(jdbc.queryForObject("SELECT status FROM ai_jobs WHERE id=?", String.class, job)).isEqualTo("succeeded");

        UUID other = seed("analyze", "pending", 0);
        UUID mine = UUID.randomUUID();
        jobs.claimNext("analyze", mine, LEASE, now);
        jdbc.update("UPDATE ai_jobs SET lease_token=? WHERE id=?", UUID.randomUUID(), other);

        assertThatThrownBy(() -> jobs.succeed(other, mine, now)).isInstanceOf(LeaseOwnershipException.class);
        assertThat(jdbc.queryForObject("SELECT status FROM ai_jobs WHERE id=?", String.class, other))
                .as("재선점된 작업의 완료는 받아들이지 않는다").isEqualTo("running");
    }

    @Test
    @DisplayName("practice.analyze: release 는 다시 대기로 돌리되 시도 수를 되돌리지 않는다. 실패는 사유와 함께 닫고 lease 를 지운다")
    void aiJobs_releaseKeepsTheAttemptCountAndFailIsFinal() {
        UUID job = seed("analyze", "pending", 0);
        UUID token = UUID.randomUUID();
        jobs.claimNext("analyze", token, LEASE, now);

        jobs.release(job, token, "storage", now);

        Map<String, Object> released = jdbc.queryForMap("SELECT status,attempt_count,lease_token FROM ai_jobs WHERE id=?", job);
        assertThat(released).containsEntry("status", "pending").containsEntry("attempt_count", 1);
        assertThat(released.get("lease_token")).isNull();

        UUID second = UUID.randomUUID();
        AiJobLedger.Claimed again = jobs.claimNext("analyze", second, LEASE, now);
        assertThat(again.attemptCount()).as("되돌리지 않으므로 두 번째다").isEqualTo(2);

        assertThat(jobs.fail(job, second, "timeout", now)).isTrue();
        Map<String, Object> failed = jdbc.queryForMap(
                "SELECT status,failure_reason,lease_token,lease_expires_at FROM ai_jobs WHERE id=?", job);
        assertThat(failed).containsEntry("status", "failed").containsEntry("failure_reason", "timeout");
        assertThat(failed.get("lease_token")).isNull();
        assertThat(failed.get("lease_expires_at")).isNull();
        assertThat(jobs.claimNext("analyze", UUID.randomUUID(), LEASE, now)).as("닫힌 작업은 집히지 않는다").isNull();
    }

    @Test
    @DisplayName("practice.analyze: 시도 세 번을 소진한 작업은 sweep 이 실패로 닫는다 — 그 전에는 집히고 그 뒤로는 집히지 않는다")
    void aiJobs_threeAttemptsThenSweepClosesIt() {
        UUID job = seed("analyze", "pending", 0);
        for (int attempt = 1; attempt <= AiJobLedger.MAX_ATTEMPTS; attempt++) {
            UUID token = UUID.randomUUID();
            AiJobLedger.Claimed claimed = jobs.claimNext("analyze", token, LEASE, now);
            assertThat(claimed).as("시도 " + attempt).isNotNull();
            assertThat(claimed.attemptCount()).isEqualTo(attempt);
            jobs.release(job, token, "storage", now);
        }

        assertThat(jobs.claimNext("analyze", UUID.randomUUID(), LEASE, now))
                .as("시도를 소진하면 더 집지 않는다").isNull();
        assertThat(jdbc.queryForObject("SELECT status FROM ai_jobs WHERE id=?", String.class, job)).isEqualTo("pending");

        assertThat(jobs.sweepMaxAttempts(now)).isEqualTo(1);

        assertThat(jdbc.queryForMap("SELECT status,failure_reason FROM ai_jobs WHERE id=?", job))
                .containsEntry("status", "failed").containsEntry("failure_reason", "storage");
        assertThat(jobs.sweepMaxAttempts(now)).as("두 번 쓸어도 같은 행을 다시 담지 않는다").isZero();
    }

    @Test
    @DisplayName("넣기: 부르는 쪽의 트랜잭션에 참여한다 — 대기 작업이 생기고, 그 트랜잭션이 되돌아가면 작업도 없다. 트랜잭션 밖에서는 거절한다")
    void aiJobs_enqueueJoinsTheCallersTransaction() {
        UUID target = UUID.randomUUID();
        UUID request = UUID.randomUUID();

        UUID job = transaction.execute(tx -> jobs.enqueue(user, "analyze", target, request, "f".repeat(64), now));

        assertThat(jdbc.queryForMap(
                "SELECT user_id,kind,target_id,request_id,status,attempt_count,memory_epoch,created_at FROM ai_jobs WHERE id=?", job))
                .containsEntry("user_id", user)
                .containsEntry("kind", "analyze")
                .containsEntry("target_id", target)
                .containsEntry("request_id", request)
                .containsEntry("status", "pending")
                .containsEntry("attempt_count", 0)
                .containsEntry("memory_epoch", null)
                .containsEntry("created_at", java.sql.Timestamp.from(now));

        transaction.executeWithoutResult(tx -> {
            jobs.enqueue(user, "analyze", UUID.randomUUID(), UUID.randomUUID(), "f".repeat(64), now);
            tx.setRollbackOnly();
        });
        assertThat(jdbc.queryForObject("SELECT count(*) FROM ai_jobs", Integer.class)).isEqualTo(1);
        assertThatThrownBy(() -> jobs.enqueue(user, "analyze", UUID.randomUUID(), UUID.randomUUID(), "f".repeat(64), now))
                .as("트랜잭션 없이 부르면 작업만 따로 커밋될 수 있어 거절한다")
                .isInstanceOf(RuntimeException.class);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM ai_jobs", Integer.class)).isEqualTo(1);
    }

    @Test
    @DisplayName("활성 계정에만 넣기: 지금 기억 세대를 함께 적는다. 같은 요청 id 가 다시 오면 넣지 않고, 탈퇴한 계정에는 넣지 않는다")
    void aiJobs_enqueueForActiveAccountStampsTheMemoryEpochAndSkipsDuplicatesAndClosedAccounts() {
        jdbc.update("UPDATE users SET memory_epoch=7 WHERE id=?", user);
        UUID target = UUID.randomUUID();
        UUID request = UUID.randomUUID();

        assertThat(enqueueForActiveAccount(target, request)).isTrue();
        assertThat(jdbc.queryForMap("SELECT kind,target_id,status,memory_epoch FROM ai_jobs WHERE user_id=?", user))
                .containsEntry("kind", "memory_update")
                .containsEntry("target_id", target)
                .containsEntry("status", "pending")
                .containsEntry("memory_epoch", 7);

        assertThat(enqueueForActiveAccount(target, request)).as("같은 요청 id").isFalse();
        jdbc.update("UPDATE users SET status='deactivated',deactivated_at=now() WHERE id=?", user);
        assertThat(enqueueForActiveAccount(UUID.randomUUID(), UUID.randomUUID())).as("탈퇴한 계정").isFalse();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM ai_jobs", Integer.class)).isEqualTo(1);
    }

    @Test
    @DisplayName("취소: 그 종류·그 대상의 대기·실행 중 작업만 실패(cancelled)로 닫고 lease 를 뗀다. 끝난 작업, 다른 종류, 다른 대상은 그대로다")
    void aiJobs_cancelClosesOnlyTheUnfinishedJobsOfThatTarget() {
        UUID target = UUID.randomUUID();
        UUID pending = seedFor("analyze", "pending", target);
        UUID running = seedFor("analyze", "running", target);
        jdbc.update("UPDATE ai_jobs SET lease_token=?,lease_expires_at=? WHERE id=?", UUID.randomUUID(), at(now.plus(LEASE)), running);
        UUID done = seedFor("analyze", "succeeded", target);
        UUID otherKind = seedFor("memory_update", "pending", target);
        UUID otherTarget = seedFor("analyze", "pending", UUID.randomUUID());

        assertThat(cancelAnalyze(target)).isEqualTo(2);

        for (UUID closed : new UUID[] {pending, running}) {
            assertThat(jdbc.queryForMap(
                    "SELECT status,failure_reason,lease_token,lease_expires_at,updated_at FROM ai_jobs WHERE id=?", closed))
                    .containsEntry("status", "failed")
                    .containsEntry("failure_reason", "cancelled")
                    .containsEntry("lease_token", null)
                    .containsEntry("lease_expires_at", null)
                    .containsEntry("updated_at", java.sql.Timestamp.from(now));
        }
        assertThat(jdbc.queryForObject("SELECT status FROM ai_jobs WHERE id=?", String.class, done)).isEqualTo("succeeded");
        assertThat(jdbc.queryForObject("SELECT status FROM ai_jobs WHERE id=?", String.class, otherKind)).isEqualTo("pending");
        assertThat(jdbc.queryForObject("SELECT status FROM ai_jobs WHERE id=?", String.class, otherTarget)).isEqualTo("pending");
        assertThat(cancelAnalyze(target)).as("다시 부르면 닫을 것이 없다").isZero();
    }

    private boolean enqueueForActiveAccount(UUID target, UUID request) {
        return transaction.execute(tx ->
                jobs.enqueueForActiveAccount(user, "memory_update", target, request, "f".repeat(64), now));
    }

    private int cancelAnalyze(UUID target) {
        return transaction.execute(tx -> jobs.cancel("analyze", target, now));
    }

    private UUID seedFor(String kind, String status, UUID target) {
        UUID id = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO ai_jobs(id,user_id,kind,target_id,request_id,request_fingerprint,status,attempt_count)
                VALUES (?,?,?,?,?,?,?,0)
                """, id, user, kind, target, UUID.randomUUID(), "f".repeat(64), status);
        return id;
    }

    private UUID seed(String kind, String status, int attemptCount) {
        UUID id = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO ai_jobs(id,user_id,kind,target_id,request_id,request_fingerprint,status,attempt_count)
                VALUES (?,?,?,?,?,?,?,?)
                """, id, user, kind, UUID.randomUUID(), UUID.randomUUID(), "f".repeat(64), status, attemptCount);
        return id;
    }

    private static OffsetDateTime at(Instant instant) {
        return instant.atOffset(ZoneOffset.UTC);
    }
}
