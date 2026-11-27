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
import jakarta.persistence.LockModeType;
import jakarta.persistence.Tuple;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * {@code ai_jobs} 장부의 Postgres 구현 (V14). lease 상태 전이는 옛 {@code external_operations} 와 <b>같은
 * 계약</b>이다(CONTRACT §5-7). 옛 원장을 집던 선점({@code ExternalOperationClaimer})은 SOMA-1140 에서 지웠다.
 *
 * <p>선점은 잠가 읽기와 임대 적기 두 문장이다 — {@code FOR UPDATE SKIP LOCKED} 로 한 행을 잠가 고르고, 같은 트랜잭션에서
 * 토큰과 시한을 박는다. 잠근 행은 커밋까지 다른 워커가 건너뛰므로 두 워커가 같은 작업을 함께 집지 못하고, 읽은 시도 수에
 * 하나 더한 값이 방금 쓴 값이다. 집은 워커가 죽어도 시한이 지나면 다시 집힌다(apps/api/CONTRACT.md §5-9 「작업을 집는 문장」).
 *
 * <p>완료·실패·놓기는 <b>토큰이 그대로일 때만</b> 통한다. 시한이 지났어도 아직 아무도 재선점하지 않았으면
 * 받아들이고, 토큰이 바뀌었으면 {@link LeaseOwnershipException} 으로 전체를 되돌린다.
 *
 * <p><b>작업의 상태를 바꾸는 문장은 이 파일에만 둔다.</b> 허용되는 길은 {@code AiJobStatusTransition} 에 있다
 * ({@code StateTransitionTest}). 문장은 {@code AiJobEntity} 의 JPQL 이고, 다른 기능의 표를 한 문장에서 읽는 세 자리만 native 다.
 */
@Repository
class PostgresAiJobLedger implements AiJobLedger {
    /** 잠글 수 없는 행을 건너뛰는 잠금 시한 값(Hibernate 의 {@code SKIP_LOCKED}). */
    private static final String LOCK_TIMEOUT = "jakarta.persistence.lock.timeout";
    private static final int SKIP_LOCKED = -2;

    private final EntityManager entityManager;
    private final TransactionTemplate transaction;

    PostgresAiJobLedger(EntityManager entityManager, PlatformTransactionManager transactionManager) {
        this.entityManager = entityManager;
        this.transaction = new TransactionTemplate(transactionManager);
    }

    /** 집어 둔 작업 한 행. 같은 트랜잭션에서 고치므로 엔티티가 아니라 값으로 읽는다. */
    record Picked(UUID id, UUID userId, UUID targetId, int attemptCount, Integer memoryEpoch) {
    }

    @Override
    public UUID enqueue(UUID userId, String kind, UUID targetId, UUID requestId, String fingerprint, Instant now) {
        UUID id = UUID.randomUUID();
        entityManager.createQuery("""
                insert into AiJobEntity (id, userId, kind, targetId, requestId, requestFingerprint, status, attemptCount,
                                         createdAt, updatedAt)
                values (:id, :userId, :kind, :targetId, :requestId, :fingerprint, 'pending', 0, :now, :now)
                """)
                .setParameter("id", id)
                .setParameter("userId", userId)
                .setParameter("kind", kind)
                .setParameter("targetId", targetId)
                .setParameter("requestId", requestId)
                .setParameter("fingerprint", fingerprint)
                .setParameter("now", now)
                .executeUpdate();
        return id;
    }

    /**
     * {@code INSERT … SELECT FROM users} 인 것은 탈퇴한 계정에 작업이 다시 생기지 않게 하려는 것이다. 한 문장에서 다른
     * 기능(auth)의 {@code users} 를 읽고 기억 세대를 적어 native 로 남았다.
     */
    @Override
    public boolean enqueueForActiveAccount(
            UUID userId, String kind, UUID targetId, UUID requestId, String fingerprint, Instant now) {
        return !NativeTuples.list(entityManager.createNativeQuery("""
                WITH inserted AS (
                    INSERT INTO ai_jobs(id,user_id,kind,target_id,request_id,request_fingerprint,
                                        status,memory_epoch,created_at,updated_at)
                    SELECT :id,u.id,:kind,:targetId,:requestId,CAST(:fingerprint AS bpchar),
                           'pending',u.memory_epoch,:now,:now
                    FROM users u
                    WHERE u.id=:userId AND u.status='active'
                    ON CONFLICT (user_id,request_id) DO NOTHING
                    RETURNING id
                )
                SELECT id FROM inserted
                """, Tuple.class)
                .setParameter("id", UUID.randomUUID())
                .setParameter("kind", kind)
                .setParameter("targetId", targetId)
                .setParameter("requestId", requestId)
                .setParameter("fingerprint", fingerprint)
                .setParameter("userId", userId)
                .setParameter("now", now.atOffset(ZoneOffset.UTC))).isEmpty();
    }

    @Override
    public int cancel(String kind, UUID targetId, Instant now) {
        return entityManager.createQuery("""
                update AiJobEntity j
                set j.status = 'failed', j.failureReason = 'cancelled',
                    j.leaseToken = null, j.leaseExpiresAt = null, j.updatedAt = :now
                where j.targetId = :targetId
                  and j.kind = :kind
                  and j.status in ('pending', 'running')
                """)
                .setParameter("now", now)
                .setParameter("targetId", targetId)
                .setParameter("kind", kind)
                .executeUpdate();
    }

    @Override
    public int countRequestedSince(UUID userId, String kind, Instant since) {
        // 옛 원장의 종류 칸은 변환기가 붙은 enum 이라 글로 바꿔 견준다. 그 enum 에 없는 종류(script_split 등)도 0 으로 센다.
        Number requested = entityManager.createQuery("""
                select (select count(*) from AiJobEntity j
                        where j.userId = :userId and j.kind = :kind and j.createdAt >= :since)
                     + (select count(*) from ExternalOperationEntity o
                        where o.userId = :userId and cast(o.kind as String) = :kind and o.createdAt >= :since)
                """, Number.class)
                .setParameter("userId", userId)
                .setParameter("kind", kind)
                .setParameter("since", since)
                .getSingleResult();
        return requested.intValue();
    }

    @Override
    public Claimed claimNext(String kind, UUID leaseToken, Duration lease, Instant now, boolean reclaimExpired) {
        return transaction.execute(tx -> {
            List<Picked> picked = entityManager.createQuery("""
                    select new com.acttub.actingapi.platform.operation.PostgresAiJobLedger$Picked(
                           j.id, j.userId, j.targetId, j.attemptCount, j.memoryEpoch)
                    from AiJobEntity j
                    where j.kind = :kind
                      and (j.status = 'pending' or (:reclaim = true and j.status = 'running' and j.leaseExpiresAt < :now))
                      and j.attemptCount < :maxAttempts
                    order by j.createdAt, j.id
                    """, Picked.class)
                    .setParameter("kind", kind)
                    .setParameter("reclaim", reclaimExpired)
                    .setParameter("now", now)
                    .setParameter("maxAttempts", MAX_ATTEMPTS)
                    .setLockMode(LockModeType.PESSIMISTIC_WRITE)
                    .setHint(LOCK_TIMEOUT, SKIP_LOCKED)
                    .setMaxResults(1)
                    .getResultList();
            if (picked.isEmpty()) {
                return null;
            }
            Picked job = picked.getFirst();
            entityManager.createQuery("""
                    update AiJobEntity j
                    set j.status = 'running',
                        j.attemptCount = j.attemptCount + 1,
                        j.leaseToken = :leaseToken,
                        j.leaseExpiresAt = :leaseExpiresAt,
                        j.updatedAt = :now
                    where j.id = :id
                    """)
                    .setParameter("leaseToken", leaseToken)
                    .setParameter("leaseExpiresAt", now.plus(lease))
                    .setParameter("now", now)
                    .setParameter("id", job.id())
                    .executeUpdate();
            return new Claimed(job.id(), job.userId(), job.targetId(), job.attemptCount() + 1, job.memoryEpoch());
        });
    }

    @Override
    public boolean succeed(UUID jobId, UUID leaseToken, Instant now) {
        return close(jobId, leaseToken, """
                update AiJobEntity j
                set j.status = 'succeeded', j.failureReason = :reason,
                    j.leaseToken = null, j.leaseExpiresAt = null, j.updatedAt = :now
                where j.id = :jobId
                  and j.status = 'running'
                """, null, now);
    }

    @Override
    public boolean fail(UUID jobId, UUID leaseToken, String reason, Instant now) {
        return close(jobId, leaseToken, """
                update AiJobEntity j
                set j.status = 'failed', j.failureReason = :reason,
                    j.leaseToken = null, j.leaseExpiresAt = null, j.updatedAt = :now
                where j.id = :jobId
                  and j.status = 'running'
                """, reason, now);
    }

    /**
     * 탈퇴한 계정의 끝나지 않은 작업을 닫는다(사유 {@code account_deactivated}). lease 를 떼므로 돌던 워커의 완료는 저장되지
     * 않고, 결과 본문도 비운다. 트랜잭션을 열지 않는다 — 계정을 닫는 트랜잭션에 참여한다.
     */
    void failAllOfClosedAccount(UUID userId, Instant now) {
        entityManager.createQuery("""
                update AiJobEntity j
                set j.status = 'failed', j.failureReason = 'account_deactivated',
                    j.leaseToken = null, j.leaseExpiresAt = null, j.result = null, j.updatedAt = :now
                where j.userId = :userId
                  and j.status in ('pending', 'running')
                """)
                .setParameter("now", now)
                .setParameter("userId", userId)
                .executeUpdate();
    }

    /**
     * 지우는 연습 묶음의 끝나지 않은 작업을 닫고(사유 {@code practice_deleted}), 그 묶음의 작업 행을 보관 계정에 넘긴다.
     * 작업의 대상은 회차이거나 그 회차의 코치 대화다 — 대화는 한 문장 안에서 코치의 테이블을 읽어 고르므로 두 문장은 native 로
     * 남았다(먼저 읽으면 문장이 늘어 {@code AccountLifecycleFreezeIT} 가 받지 않는다). 트랜잭션을 열지 않는다 — 연습을 지우는
     * 트랜잭션에 참여한다.
     */
    void failAndHandOverOfDeletedPractices(UUID userId, List<UUID> practiceIds, UUID keeper, Instant now) {
        entityManager.createNativeQuery("""
                UPDATE ai_jobs
                SET status='failed',failure_reason='practice_deleted',
                    lease_token=NULL,lease_expires_at=NULL,result=NULL,updated_at=:now
                WHERE user_id=:userId
                  AND status IN ('pending','running')
                  AND (target_id IN (:practiceIds)
                       OR target_id IN (SELECT id FROM coach_conversations WHERE practice_id IN (:practiceIds)))
                """)
                .setParameter("now", now.atOffset(ZoneOffset.UTC))
                .setParameter("userId", userId)
                .setParameter("practiceIds", practiceIds)
                .executeUpdate();
        entityManager.createNativeQuery("""
                UPDATE ai_jobs
                SET user_id=:keeper,updated_at=:now
                WHERE user_id=:userId
                  AND (target_id IN (:practiceIds)
                       OR target_id IN (SELECT id FROM coach_conversations WHERE practice_id IN (:practiceIds)))
                """)
                .setParameter("keeper", keeper)
                .setParameter("now", now.atOffset(ZoneOffset.UTC))
                .setParameter("userId", userId)
                .setParameter("practiceIds", practiceIds)
                .executeUpdate();
    }

    @Override
    public void release(UUID jobId, UUID leaseToken, String reason, Instant now) {
        requireOwnedLease(jobId, leaseToken);
        // ⚠ attempt_count 를 되돌리지 않는다(§5-7) — 되돌리면 같은 작업이 영원히 돈다.
        transaction.executeWithoutResult(tx -> entityManager.createQuery("""
                update AiJobEntity j
                set j.status = 'pending', j.failureReason = :reason,
                    j.leaseToken = null, j.leaseExpiresAt = null, j.updatedAt = :now
                where j.id = :jobId
                  and j.status = 'running'
                """)
                .setParameter("reason", reason)
                .setParameter("now", now)
                .setParameter("jobId", jobId)
                .executeUpdate());
    }

    @Override
    public int sweepMaxAttempts(Instant now) {
        return transaction.execute(tx -> entityManager.createQuery("""
                update AiJobEntity j
                set j.status = 'failed', j.failureReason = coalesce(j.failureReason, 'max_attempts'),
                    j.leaseToken = null, j.leaseExpiresAt = null, j.updatedAt = :now
                where j.status = 'pending'
                  and j.attemptCount >= :maxAttempts
                """)
                .setParameter("now", now)
                .setParameter("maxAttempts", MAX_ATTEMPTS)
                .executeUpdate());
    }

    /**
     * HQL 에 {@code RETURNING} 이 없어 닫을 행을 잠가 읽은 뒤 그 id 로 닫는다. 잠가 읽기는 native {@code UPDATE} 처럼 다른
     * 트랜잭션이 잡은 행을 기다렸다가 조건을 다시 보고, 잠근 행은 커밋까지 바뀌지 않는다. 닫을 것이 없으면 읽기 한 문장이다.
     */
    @Override
    public List<UUID> failExpired(String kind, Instant now) {
        return transaction.execute(tx -> {
            List<UUID> expired = entityManager.createQuery("""
                    select j.id from AiJobEntity j
                    where j.kind = :kind
                      and j.status = 'running'
                      and j.leaseExpiresAt < :now
                      and j.attemptCount >= :maxAttempts
                    """, UUID.class)
                    .setParameter("kind", kind)
                    .setParameter("now", now)
                    .setParameter("maxAttempts", MAX_ATTEMPTS)
                    .setLockMode(LockModeType.PESSIMISTIC_WRITE)
                    .getResultList();
            if (expired.isEmpty()) {
                return expired;
            }
            entityManager.createQuery("""
                    update AiJobEntity j
                    set j.status = 'failed', j.failureReason = 'max_attempts',
                        j.leaseToken = null, j.leaseExpiresAt = null, j.updatedAt = :now
                    where j.id in :ids
                      and j.status = 'running'
                    """)
                    .setParameter("now", now)
                    .setParameter("ids", expired)
                    .executeUpdate();
            return expired;
        });
    }

    /** 상태 값은 문장에 글자 그대로 적는다 — 어느 길로 넘어가는지 문장에서 읽히게({@code StateTransitionTest}). */
    private boolean close(UUID jobId, UUID leaseToken, String statement, String reason, Instant now) {
        requireOwnedLease(jobId, leaseToken);
        return transaction.execute(tx -> entityManager.createQuery(statement)
                .setParameter("reason", reason)
                .setParameter("now", now)
                .setParameter("jobId", jobId)
                .executeUpdate()) > 0;
    }

    /**
     * 그 작업의 lease 가 아직 이 워커의 것인가. 시한이 지났어도 <b>아무도 재선점하지 않았으면</b> 그대로다 —
     * 토큰이 바뀌었을 때만 거절한다(§5-7).
     */
    private void requireOwnedLease(UUID jobId, UUID leaseToken) {
        List<UUID> rows = entityManager.createQuery("select j.leaseToken from AiJobEntity j where j.id = :jobId", UUID.class)
                .setParameter("jobId", jobId)
                .getResultList();
        if (rows.isEmpty()) {
            return;
        }
        UUID current = rows.getFirst();
        if (current != null && !current.equals(leaseToken)) {
            throw new LeaseOwnershipException("ai_jobs lease was reclaimed: " + jobId);
        }
    }
}
