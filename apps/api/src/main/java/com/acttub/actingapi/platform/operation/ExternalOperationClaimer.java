package com.acttub.actingapi.platform.operation;

import static com.acttub.actingapi.platform.persistence.NativeTuples.list;

import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.platform.ledger.LeaseOwnershipException;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Tuple;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 원본의 blocking + 재평가 시맨틱을 보존한다. 의도적으로 {@code SKIP LOCKED}가 없다.
 * Python SQLAlchemy의 JSONB {@code None}은 SQL NULL이 아니라 JSON 리터럴 {@code null}이다.
 */
@Repository
public class ExternalOperationClaimer {

    public static final int MAX_EXTERNAL_OPERATION_ATTEMPTS = 3;

    private static final String ANALYZE = "analyze";
    private static final String MAX_ATTEMPTS_ERROR = "max_attempts_exceeded";

    private final EntityManager entityManager;
    private final TransactionTemplate transactionTemplate;

    public ExternalOperationClaimer(
            EntityManager entityManager,
            PlatformTransactionManager transactionManager) {
        this.entityManager = entityManager;
        this.transactionTemplate = new TransactionTemplate(transactionManager);
        this.transactionTemplate.setPropagationBehavior(
                TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    }

    public UUID claimNext(String kind, UUID leaseToken, Duration duration, Instant now) {
        OffsetDateTime claimedAt = now.atOffset(ZoneOffset.UTC);
        OffsetDateTime expiresAt = now.plus(duration).atOffset(ZoneOffset.UTC);
        return transactionTemplate.execute(status -> claimNextInTransaction(
                kind, leaseToken, claimedAt, expiresAt));
    }

    public UUID claimById(
            UUID operationId,
            UUID leaseToken,
            Duration duration,
            Instant now) {
        OffsetDateTime claimedAt = now.atOffset(ZoneOffset.UTC);
        OffsetDateTime expiresAt = now.plus(duration).atOffset(ZoneOffset.UTC);
        return transactionTemplate.execute(status -> claimByIdInTransaction(
                operationId, leaseToken, claimedAt, expiresAt));
    }

    public boolean fail(
            UUID operationId,
            UUID leaseToken,
            String errorCode,
            boolean failSession,
            Instant now) {
        OffsetDateTime failedAt = now.atOffset(ZoneOffset.UTC);
        return Boolean.TRUE.equals(transactionTemplate.execute(status ->
                failInTransaction(
                        operationId, leaseToken, errorCode, failSession, failedAt)));
    }

    public boolean release(UUID operationId, UUID leaseToken, Instant now) {
        OffsetDateTime releasedAt = now.atOffset(ZoneOffset.UTC);
        return Boolean.TRUE.equals(transactionTemplate.execute(status -> {
            int released = entityManager.createNativeQuery("""
                    UPDATE external_operations
                    SET status = 'pending',
                        response_payload = 'null'::jsonb,
                        error_code = NULL,
                        lease_token = NULL,
                        lease_expires_at = NULL,
                        updated_at = :releasedAt
                    WHERE id = :operationId
                      AND status = 'running'
                      AND lease_token = :leaseToken
                    """)
                    .setParameter("releasedAt", releasedAt)
                    .setParameter("operationId", operationId)
                    .setParameter("leaseToken", leaseToken)
                    .executeUpdate();
            if (released == 0) {
                throw leaseOwnershipError();
            }
            return true;
        }));
    }

    public int sweepMaxAttempts(Instant now) {
        OffsetDateTime sweptAt = now.atOffset(ZoneOffset.UTC);
        Integer swept = transactionTemplate.execute(status ->
                sweepMaxAttemptsInTransaction(sweptAt));
        return swept == null ? 0 : swept;
    }

    private UUID claimByIdInTransaction(
            UUID operationId,
            UUID leaseToken,
            OffsetDateTime claimedAt,
            OffsetDateTime expiresAt) {
        List<Tuple> claimed = list(entityManager.createNativeQuery("""
                WITH claimed AS (
                    UPDATE external_operations
                    SET status = 'running',
                        attempt_count = attempt_count + 1,
                        lease_token = :leaseToken,
                        lease_expires_at = :expiresAt,
                        error_code = NULL,
                        response_payload = 'null'::jsonb,
                        updated_at = :claimedAt
                    WHERE id = :operationId
                      AND attempt_count < :maxAttempts
                      AND (
                          (status = 'pending' AND lease_token IS NULL)
                          OR (status = 'running' AND lease_expires_at < :claimedAt)
                          OR (status = 'failed' AND lease_token IS NULL)
                      )
                    RETURNING id
                )
                SELECT id FROM claimed
                """, Tuple.class)
                .setParameter("leaseToken", leaseToken)
                .setParameter("expiresAt", expiresAt)
                .setParameter("claimedAt", claimedAt)
                .setParameter("operationId", operationId)
                .setParameter("maxAttempts", MAX_EXTERNAL_OPERATION_ATTEMPTS));
        return claimed.isEmpty() ? null : claimed.getFirst().get("id", UUID.class);
    }

    private UUID claimNextInTransaction(
            String kind,
            UUID leaseToken,
            OffsetDateTime claimedAt,
            OffsetDateTime expiresAt) {
        List<Tuple> claimed = list(entityManager.createNativeQuery("""
                WITH claimed AS (
                    UPDATE external_operations
                    SET status = 'running',
                        attempt_count = attempt_count + 1,
                        lease_token = :leaseToken,
                        lease_expires_at = :expiresAt,
                        error_code = NULL,
                        response_payload = 'null'::jsonb,
                        updated_at = :claimedAt
                    WHERE id = (
                        SELECT id
                        FROM external_operations
                        WHERE kind = :kind
                          AND attempt_count < :maxAttempts
                          AND (
                              (status = 'pending' AND lease_token IS NULL)
                              OR (status = 'running' AND lease_expires_at < :claimedAt)
                          )
                        ORDER BY created_at, id
                        LIMIT 1
                    )
                      AND kind = :kind
                      AND attempt_count < :maxAttempts
                      AND (
                          (status = 'pending' AND lease_token IS NULL)
                          OR (status = 'running' AND lease_expires_at < :claimedAt)
                      )
                    RETURNING id, session_id
                )
                SELECT id, session_id FROM claimed
                """, Tuple.class)
                .setParameter("leaseToken", leaseToken)
                .setParameter("expiresAt", expiresAt)
                .setParameter("claimedAt", claimedAt)
                .setParameter("kind", kind)
                .setParameter("maxAttempts", MAX_EXTERNAL_OPERATION_ATTEMPTS));

        if (claimed.isEmpty()) {
            return null;
        }

        Tuple operation = claimed.getFirst();
        if (ANALYZE.equals(kind)) {
            entityManager.createNativeQuery("""
                    UPDATE practice_sessions
                    SET status = 'analyzing',
                        updated_at = :claimedAt
                    WHERE id = :sessionId
                    """)
                    .setParameter("claimedAt", claimedAt)
                    .setParameter("sessionId", operation.get("session_id", UUID.class))
                    .executeUpdate();
        }
        return operation.get("id", UUID.class);
    }

    private boolean failInTransaction(
            UUID operationId,
            UUID leaseToken,
            String errorCode,
            boolean failSession,
            OffsetDateTime failedAt) {
        List<Tuple> operations = list(entityManager.createNativeQuery("""
                SELECT session_id AS session_id
                FROM external_operations
                WHERE id = :operationId
                """, Tuple.class)
                .setParameter("operationId", operationId));
        if (operations.isEmpty()) {
            return false;
        }

        if (failSession) {
            entityManager.createNativeQuery("""
                    UPDATE practice_sessions
                    SET status = 'failed',
                        updated_at = :failedAt
                    WHERE id = :sessionId
                    """)
                    .setParameter("failedAt", failedAt)
                    .setParameter(
                            "sessionId", operations.getFirst().get("session_id", UUID.class))
                    .executeUpdate();
        }

        int finished = entityManager.createNativeQuery("""
                UPDATE external_operations
                SET status = 'failed',
                    response_payload = 'null'::jsonb,
                    error_code = :errorCode,
                    lease_token = NULL,
                    lease_expires_at = NULL,
                    updated_at = :failedAt
                WHERE id = :operationId
                  AND status = 'running'
                  AND lease_token = :leaseToken
                """)
                .setParameter("errorCode", errorCode)
                .setParameter("failedAt", failedAt)
                .setParameter("operationId", operationId)
                .setParameter("leaseToken", leaseToken)
                .executeUpdate();
        if (finished == 0) {
            throw leaseOwnershipError();
        }
        return true;
    }

    private int sweepMaxAttemptsInTransaction(OffsetDateTime sweptAt) {
        List<Tuple> swept = list(entityManager.createNativeQuery("""
                WITH swept AS (
                    UPDATE external_operations
                    SET status = 'failed',
                        error_code = :errorCode,
                        response_payload = 'null'::jsonb,
                        lease_token = NULL,
                        lease_expires_at = NULL,
                        updated_at = :sweptAt
                    WHERE status IN ('pending', 'running', 'failed')
                      AND attempt_count >= :maxAttempts
                      AND (error_code IS NULL OR error_code <> :errorCode)
                      AND (lease_token IS NULL OR lease_expires_at < :sweptAt)
                    RETURNING session_id, kind
                )
                SELECT session_id, kind FROM swept
                """, Tuple.class)
                .setParameter("errorCode", MAX_ATTEMPTS_ERROR)
                .setParameter("sweptAt", sweptAt)
                .setParameter("maxAttempts", MAX_EXTERNAL_OPERATION_ATTEMPTS));

        for (Tuple operation : swept) {
            if (ANALYZE.equals(operation.get("kind", String.class))) {
                entityManager.createNativeQuery("""
                        UPDATE practice_sessions
                        SET status = 'failed',
                            updated_at = :sweptAt
                        WHERE id = :sessionId
                          AND status = 'analyzing'
                        """)
                        .setParameter("sweptAt", sweptAt)
                        .setParameter("sessionId", operation.get("session_id", UUID.class))
                        .executeUpdate();
            }
        }
        return swept.size();
    }

    private static LeaseOwnershipException leaseOwnershipError() {
        return new LeaseOwnershipException("external operation lease is not owned");
    }
}
