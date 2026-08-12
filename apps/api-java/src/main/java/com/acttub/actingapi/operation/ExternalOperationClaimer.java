package com.acttub.actingapi.operation;

import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.report.LeaseOwnershipException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

/** 원본의 blocking + 재평가 시맨틱을 보존한다. 의도적으로 {@code SKIP LOCKED}가 없다. */
@Repository
public class ExternalOperationClaimer {

    public static final int MAX_EXTERNAL_OPERATION_ATTEMPTS = 3;

    private static final String ANALYZE = "analyze";
    private static final String MAX_ATTEMPTS_ERROR = "max_attempts_exceeded";

    private final JdbcTemplate jdbc;
    private final TransactionTemplate transactionTemplate;

    public ExternalOperationClaimer(
            JdbcTemplate jdbc,
            PlatformTransactionManager transactionManager) {
        this.jdbc = jdbc;
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
            int released = jdbc.update("""
                    UPDATE external_operations
                    SET status = 'pending'::operation_status_t,
                        response_payload = NULL,
                        error_code = NULL,
                        lease_token = NULL,
                        lease_expires_at = NULL,
                        updated_at = ?
                    WHERE id = ?
                      AND status = 'running'::operation_status_t
                      AND lease_token = ?
                    """, releasedAt, operationId, leaseToken);
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
        List<UUID> claimed = jdbc.query("""
                UPDATE external_operations
                SET status = 'running'::operation_status_t,
                    attempt_count = attempt_count + 1,
                    lease_token = ?,
                    lease_expires_at = ?,
                    error_code = NULL,
                    response_payload = NULL,
                    updated_at = ?
                WHERE id = ?
                  AND attempt_count < ?
                  AND (
                      (status = 'pending'::operation_status_t AND lease_token IS NULL)
                      OR (status = 'running'::operation_status_t AND lease_expires_at < ?)
                      OR (status = 'failed'::operation_status_t AND lease_token IS NULL)
                  )
                RETURNING id
                """,
                (row, rowNumber) -> row.getObject("id", UUID.class),
                leaseToken,
                expiresAt,
                claimedAt,
                operationId,
                MAX_EXTERNAL_OPERATION_ATTEMPTS,
                claimedAt);
        return claimed.isEmpty() ? null : claimed.getFirst();
    }

    private UUID claimNextInTransaction(
            String kind,
            UUID leaseToken,
            OffsetDateTime claimedAt,
            OffsetDateTime expiresAt) {
        List<ClaimedOperation> claimed = jdbc.query("""
                UPDATE external_operations
                SET status = 'running'::operation_status_t,
                    attempt_count = attempt_count + 1,
                    lease_token = ?,
                    lease_expires_at = ?,
                    error_code = NULL,
                    response_payload = NULL,
                    updated_at = ?
                WHERE id = (
                    SELECT id
                    FROM external_operations
                    WHERE kind = ?::operation_kind_t
                      AND attempt_count < ?
                      AND (
                          (status = 'pending'::operation_status_t AND lease_token IS NULL)
                          OR (status = 'running'::operation_status_t AND lease_expires_at < ?)
                      )
                    ORDER BY created_at, id
                    LIMIT 1
                )
                  AND kind = ?::operation_kind_t
                  AND attempt_count < ?
                  AND (
                      (status = 'pending'::operation_status_t AND lease_token IS NULL)
                      OR (status = 'running'::operation_status_t AND lease_expires_at < ?)
                  )
                RETURNING id, session_id
                """,
                (row, rowNumber) -> new ClaimedOperation(
                        row.getObject("id", UUID.class),
                        row.getObject("session_id", UUID.class)),
                leaseToken,
                expiresAt,
                claimedAt,
                kind,
                MAX_EXTERNAL_OPERATION_ATTEMPTS,
                claimedAt,
                kind,
                MAX_EXTERNAL_OPERATION_ATTEMPTS,
                claimedAt);

        if (claimed.isEmpty()) {
            return null;
        }

        ClaimedOperation operation = claimed.getFirst();
        if (ANALYZE.equals(kind)) {
            jdbc.update("""
                    UPDATE practice_sessions
                    SET status = 'analyzing'::practice_status_t,
                        updated_at = ?
                    WHERE id = ?
                    """, claimedAt, operation.sessionId());
        }
        return operation.id();
    }

    private boolean failInTransaction(
            UUID operationId,
            UUID leaseToken,
            String errorCode,
            boolean failSession,
            OffsetDateTime failedAt) {
        List<UUID> sessionIds = jdbc.queryForList("""
                SELECT session_id
                FROM external_operations
                WHERE id = ?
                """, UUID.class, operationId);
        if (sessionIds.isEmpty()) {
            return false;
        }

        if (failSession) {
            jdbc.update("""
                    UPDATE practice_sessions
                    SET status = 'failed'::practice_status_t,
                        updated_at = ?
                    WHERE id = ?
                    """, failedAt, sessionIds.getFirst());
        }

        int finished = jdbc.update("""
                UPDATE external_operations
                SET status = 'failed'::operation_status_t,
                    response_payload = NULL,
                    error_code = ?,
                    lease_token = NULL,
                    lease_expires_at = NULL,
                    updated_at = ?
                WHERE id = ?
                  AND status = 'running'::operation_status_t
                  AND lease_token = ?
                """, errorCode, failedAt, operationId, leaseToken);
        if (finished == 0) {
            throw leaseOwnershipError();
        }
        return true;
    }

    private int sweepMaxAttemptsInTransaction(OffsetDateTime sweptAt) {
        List<SweptOperation> swept = jdbc.query("""
                UPDATE external_operations
                SET status = 'failed'::operation_status_t,
                    error_code = ?,
                    response_payload = NULL,
                    lease_token = NULL,
                    lease_expires_at = NULL,
                    updated_at = ?
                WHERE status IN (
                    'pending'::operation_status_t,
                    'running'::operation_status_t,
                    'failed'::operation_status_t
                )
                  AND attempt_count >= ?
                  AND (error_code IS NULL OR error_code <> ?)
                  AND (lease_token IS NULL OR lease_expires_at < ?)
                RETURNING session_id, kind::text AS kind
                """,
                (row, rowNumber) -> new SweptOperation(
                        row.getObject("session_id", UUID.class),
                        row.getString("kind")),
                MAX_ATTEMPTS_ERROR,
                sweptAt,
                MAX_EXTERNAL_OPERATION_ATTEMPTS,
                MAX_ATTEMPTS_ERROR,
                sweptAt);

        for (SweptOperation operation : swept) {
            if (ANALYZE.equals(operation.kind())) {
                jdbc.update("""
                        UPDATE practice_sessions
                        SET status = 'failed'::practice_status_t,
                            updated_at = ?
                        WHERE id = ?
                          AND status = 'analyzing'::practice_status_t
                        """, sweptAt, operation.sessionId());
            }
        }
        return swept.size();
    }

    private static LeaseOwnershipException leaseOwnershipError() {
        return new LeaseOwnershipException("external operation lease is not owned");
    }

    private record ClaimedOperation(UUID id, UUID sessionId) {
    }

    private record SweptOperation(UUID sessionId, String kind) {
    }
}
