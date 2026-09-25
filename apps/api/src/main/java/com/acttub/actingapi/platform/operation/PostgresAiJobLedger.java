package com.acttub.actingapi.platform.operation;

import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.platform.ledger.AiJobLedger;
import com.acttub.actingapi.platform.ledger.LeaseOwnershipException;
import com.acttub.actingapi.platform.persistence.NativeTuples;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Tuple;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * {@code ai_jobs} 장부의 Postgres 구현 (V14). lease 상태 전이는 {@link ExternalOperationClaimer} 와 <b>같은
 * 계약</b>이다(CONTRACT §5-7) — 두 원장이 공존하는 동안 분석의 재시도 횟수와 최종 사유가 달라지면 안 된다.
 *
 * <p>선점은 한 문장이다 — {@code FOR UPDATE SKIP LOCKED} 로 고르고 같은 문장에서 토큰과 시한을 박는다. 그래서
 * 두 워커가 같은 작업을 함께 집지 못하고, 집은 워커가 죽어도 시한이 지나면 다시 집힌다.
 *
 * <p>완료·실패·놓기는 <b>토큰이 그대로일 때만</b> 통한다. 시한이 지났어도 아직 아무도 재선점하지 않았으면
 * 받아들이고, 토큰이 바뀌었으면 {@link LeaseOwnershipException} 으로 전체를 되돌린다.
 */
@Repository
class PostgresAiJobLedger implements AiJobLedger {
    private final EntityManager entityManager;
    private final TransactionTemplate transaction;

    PostgresAiJobLedger(EntityManager entityManager, PlatformTransactionManager transactionManager) {
        this.entityManager = entityManager;
        this.transaction = new TransactionTemplate(transactionManager);
    }

    @Override
    public Claimed claimNext(String kind, UUID leaseToken, Duration lease, Instant now) {
        return transaction.execute(tx -> {
            List<Tuple> claimed = NativeTuples.list(entityManager.createNativeQuery("""
                    WITH picked AS (
                        SELECT id
                        FROM ai_jobs
                        WHERE kind=:kind
                          AND status='pending'
                          AND attempt_count<:maxAttempts
                        ORDER BY created_at,id
                        LIMIT 1
                        FOR UPDATE SKIP LOCKED
                    )
                    UPDATE ai_jobs
                    SET status='running',
                        attempt_count=attempt_count+1,
                        lease_token=:leaseToken,
                        lease_expires_at=:leaseExpiresAt,
                        updated_at=:now
                    WHERE id IN (SELECT id FROM picked)
                    RETURNING id,user_id,target_id,attempt_count,memory_epoch
                    """, Tuple.class)
                    .setParameter("kind", kind)
                    .setParameter("maxAttempts", MAX_ATTEMPTS)
                    .setParameter("leaseToken", leaseToken)
                    .setParameter("leaseExpiresAt", now.plus(lease).atOffset(ZoneOffset.UTC))
                    .setParameter("now", now.atOffset(ZoneOffset.UTC)));
            if (claimed.isEmpty()) {
                return null;
            }
            Tuple row = claimed.getFirst();
            return new Claimed(
                    row.get("id", UUID.class),
                    row.get("user_id", UUID.class),
                    row.get("target_id", UUID.class),
                    row.get("attempt_count", Integer.class),
                    row.get("memory_epoch", Integer.class));
        });
    }

    @Override
    public boolean succeed(UUID jobId, UUID leaseToken, Instant now) {
        return close(jobId, leaseToken, "succeeded", null, now);
    }

    @Override
    public boolean fail(UUID jobId, UUID leaseToken, String reason, Instant now) {
        return close(jobId, leaseToken, "failed", reason, now);
    }

    @Override
    public void release(UUID jobId, UUID leaseToken, String reason, Instant now) {
        requireOwnedLease(jobId, leaseToken);
        // ⚠ attempt_count 를 되돌리지 않는다(§5-7) — 되돌리면 같은 작업이 영원히 돈다.
        transaction.executeWithoutResult(tx -> entityManager.createNativeQuery("""
                UPDATE ai_jobs
                SET status='pending',failure_reason=:reason,
                    lease_token=NULL,lease_expires_at=NULL,updated_at=:now
                WHERE id=:jobId
                  AND status='running'
                """)
                .setParameter("reason", reason)
                .setParameter("now", now.atOffset(ZoneOffset.UTC))
                .setParameter("jobId", jobId)
                .executeUpdate());
    }

    @Override
    public int sweepMaxAttempts(Instant now) {
        return transaction.execute(tx -> entityManager.createNativeQuery("""
                UPDATE ai_jobs
                SET status='failed',failure_reason=COALESCE(failure_reason,'max_attempts'),
                    lease_token=NULL,lease_expires_at=NULL,updated_at=:now
                WHERE status='pending'
                  AND attempt_count>=:maxAttempts
                """)
                .setParameter("now", now.atOffset(ZoneOffset.UTC))
                .setParameter("maxAttempts", MAX_ATTEMPTS)
                .executeUpdate());
    }

    private boolean close(UUID jobId, UUID leaseToken, String status, String reason, Instant now) {
        requireOwnedLease(jobId, leaseToken);
        return transaction.execute(tx -> entityManager.createNativeQuery("""
                UPDATE ai_jobs
                SET status=:status,failure_reason=:reason,
                    lease_token=NULL,lease_expires_at=NULL,updated_at=:now
                WHERE id=:jobId
                  AND status='running'
                """)
                .setParameter("status", status)
                .setParameter("reason", reason)
                .setParameter("now", now.atOffset(ZoneOffset.UTC))
                .setParameter("jobId", jobId)
                .executeUpdate()) > 0;
    }

    /**
     * 그 작업의 lease 가 아직 이 워커의 것인가. 시한이 지났어도 <b>아무도 재선점하지 않았으면</b> 그대로다 —
     * 토큰이 바뀌었을 때만 거절한다(§5-7).
     */
    private void requireOwnedLease(UUID jobId, UUID leaseToken) {
        List<Tuple> rows = NativeTuples.list(entityManager.createNativeQuery(
                "SELECT lease_token FROM ai_jobs WHERE id=:jobId", Tuple.class)
                .setParameter("jobId", jobId));
        if (rows.isEmpty()) {
            return;
        }
        UUID current = rows.getFirst().get("lease_token", UUID.class);
        if (current != null && !current.equals(leaseToken)) {
            throw new LeaseOwnershipException("ai_jobs lease was reclaimed: " + jobId);
        }
    }
}
