package com.acttub.actingapi.operation;

import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

/** 원본의 blocking + 재평가 시맨틱을 보존한다. 의도적으로 {@code SKIP LOCKED}가 없다. */
@Repository
public class ExternalOperationClaimer {

    private static final String ANALYZE = "analyze";

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
                      AND attempt_count < 3
                      AND (
                          (status = 'pending'::operation_status_t AND lease_token IS NULL)
                          OR (status = 'running'::operation_status_t AND lease_expires_at < ?)
                      )
                    ORDER BY created_at, id
                    LIMIT 1
                )
                  AND kind = ?::operation_kind_t
                  AND attempt_count < 3
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
                claimedAt,
                kind,
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

    private record ClaimedOperation(UUID id, UUID sessionId) {
    }
}
