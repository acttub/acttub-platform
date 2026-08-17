package com.acttub.actingapi.feature.practice.adapter.db;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.practice.app.ExternalOperationRow;
import com.acttub.actingapi.feature.practice.app.PracticeSessionLedger;
import com.acttub.actingapi.feature.practice.app.PracticeSessionOperation;
import com.acttub.actingapi.feature.practice.app.PracticeSessionRow;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 세션 행과 {@code external_operations} 행을 한 트랜잭션에서 함께 남긴다.
 *
 * <p>전파를 {@code REQUIRES_NEW} 로 고정한다 — 호출한 쪽이 이미 트랜잭션 안이어도 이 두 행은
 * 자기 트랜잭션에서 커밋돼야, 뒤이어 실패하더라도 작업이 원장에 남는다.
 */
@Repository
public class PostgresPracticeSessionLedger implements PracticeSessionLedger {

    private static final String SHA256_ERROR =
            "SHA-256 values must be 64 hexadecimal characters";

    private final JdbcTemplate jdbc;
    private final ObjectMapper objectMapper;
    private final TransactionTemplate transactionTemplate;

    public PostgresPracticeSessionLedger(
            JdbcTemplate jdbc,
            ObjectMapper objectMapper,
            PlatformTransactionManager transactionManager) {
        this.jdbc = jdbc;
        this.objectMapper = objectMapper;
        this.transactionTemplate = new TransactionTemplate(transactionManager);
        this.transactionTemplate.setPropagationBehavior(
                TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    }

    @Override
    public PracticeSessionOperation createWithAnalysis(
            UUID userId,
            UUID uploadIntentId,
            String situation,
            String characterContext,
            String goal,
            String blockageKind,
            String subBranch,
            String blockageDetail,
            UUID requestId,
            String requestFingerprint) {
        validateSha256(requestFingerprint);
        return transactionTemplate.execute(status -> createPracticeSessionInTransaction(
                userId,
                uploadIntentId,
                situation,
                characterContext,
                goal,
                blockageKind,
                subBranch,
                blockageDetail,
                requestId,
                requestFingerprint));
    }

    @Override
    public PracticeSessionOperation createAnalysisRetry(
            UUID userId,
            UUID sessionId,
            UUID requestId,
            String requestFingerprint,
            Instant now) {
        validateSha256(requestFingerprint);
        OffsetDateTime retriedAt = (now == null ? Instant.now() : now)
                .atOffset(ZoneOffset.UTC);
        return transactionTemplate.execute(status -> createAnalysisRetryInTransaction(
                userId, sessionId, requestId, requestFingerprint, retriedAt));
    }

    private PracticeSessionOperation createPracticeSessionInTransaction(
            UUID userId,
            UUID uploadIntentId,
            String situation,
            String characterContext,
            String goal,
            String blockageKind,
            String subBranch,
            String blockageDetail,
            UUID requestId,
            String requestFingerprint) {
        if (!lockFinalizedUpload(userId, uploadIntentId)) {
            return null;
        }

        ExternalOperationRow existing = findOperation(userId, requestId);
        if (existing != null) {
            return replay(existing, requestFingerprint, null);
        }

        UUID sessionId = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO practice_sessions (
                    id,
                    user_id,
                    upload_intent_id,
                    status,
                    situation,
                    character_context,
                    goal,
                    subtext,
                    blockage_kind,
                    sub_branch,
                    blockage_detail
                )
                VALUES (
                    ?,
                    ?,
                    ?,
                    'analyzing'::practice_status_t,
                    ?,
                    ?,
                    ?,
                    NULL,
                    ?,
                    ?,
                    ?
                )
                """,
                sessionId,
                userId,
                uploadIntentId,
                situation,
                characterContext,
                goal,
                blockageKind,
                subBranch,
                blockageDetail);

        UUID operationId = insertAnalyzeOperation(
                sessionId, userId, requestId, requestFingerprint);
        if (operationId == null) {
            jdbc.update("DELETE FROM practice_sessions WHERE id = ?", sessionId);
            ExternalOperationRow winner = requireOperation(userId, requestId);
            return replay(winner, requestFingerprint, null);
        }

        return new PracticeSessionOperation(
                requireSession(sessionId),
                requireOperation(operationId),
                true,
                false);
    }

    private PracticeSessionOperation createAnalysisRetryInTransaction(
            UUID userId,
            UUID sessionId,
            UUID requestId,
            String requestFingerprint,
            OffsetDateTime retriedAt) {
        PracticeSessionRow session = lockVisibleSession(userId, sessionId);
        if (session == null) {
            return null;
        }

        ExternalOperationRow existing = findOperation(userId, requestId);
        if (existing != null) {
            return replay(existing, requestFingerprint, sessionId);
        }

        if (!"failed".equals(session.status())) {
            return null;
        }

        UUID operationId = insertAnalyzeOperation(
                sessionId, userId, requestId, requestFingerprint);
        if (operationId == null) {
            ExternalOperationRow winner = requireOperation(userId, requestId);
            return replay(winner, requestFingerprint, sessionId);
        }

        jdbc.update("""
                UPDATE practice_sessions
                SET status = 'analyzing'::practice_status_t,
                    updated_at = ?
                WHERE id = ?
                """, retriedAt, sessionId);

        return new PracticeSessionOperation(
                requireSession(sessionId),
                requireOperation(operationId),
                true,
                false);
    }

    private boolean lockFinalizedUpload(UUID userId, UUID uploadIntentId) {
        List<UUID> rows = jdbc.queryForList("""
                SELECT id
                FROM upload_intents
                WHERE id = ?
                  AND user_id = ?
                  AND status = 'finalized'::upload_status_t
                FOR UPDATE
                """, UUID.class, uploadIntentId, userId);
        return !rows.isEmpty();
    }

    private PracticeSessionRow lockVisibleSession(UUID userId, UUID sessionId) {
        List<PracticeSessionRow> rows = jdbc.query("""
                SELECT
                    id,
                    user_id,
                    upload_intent_id,
                    status::text AS status,
                    situation,
                    character_context,
                    goal,
                    subtext,
                    blockage_kind,
                    sub_branch,
                    blockage_detail,
                    hidden_at,
                    created_at,
                    updated_at
                FROM practice_sessions
                WHERE id = ?
                  AND user_id = ?
                  AND hidden_at IS NULL
                FOR UPDATE
                """, this::mapPracticeSession, sessionId, userId);
        return rows.isEmpty() ? null : rows.getFirst();
    }

    private UUID insertAnalyzeOperation(
            UUID sessionId,
            UUID userId,
            UUID requestId,
            String requestFingerprint) {
        UUID operationId = UUID.randomUUID();
        List<UUID> inserted = jdbc.query("""
                INSERT INTO external_operations (
                    id,
                    session_id,
                    user_id,
                    request_id,
                    kind,
                    request_fingerprint
                )
                VALUES (?, ?, ?, ?, 'analyze'::operation_kind_t, ?)
                ON CONFLICT (user_id, request_id) DO NOTHING
                RETURNING id
                """,
                (row, rowNumber) -> row.getObject("id", UUID.class),
                operationId,
                sessionId,
                userId,
                requestId,
                requestFingerprint);
        return inserted.isEmpty() ? null : inserted.getFirst();
    }

    private PracticeSessionOperation replay(
            ExternalOperationRow operation,
            String requestFingerprint,
            UUID expectedSessionId) {
        boolean mismatch = !operation.requestFingerprint().equals(requestFingerprint)
                || (expectedSessionId != null
                        && !operation.sessionId().equals(expectedSessionId));
        return new PracticeSessionOperation(
                requireSession(operation.sessionId()),
                operation,
                false,
                mismatch);
    }

    private ExternalOperationRow findOperation(UUID userId, UUID requestId) {
        List<ExternalOperationRow> rows = jdbc.query(
                operationSelect() + " WHERE user_id = ? AND request_id = ?",
                this::mapExternalOperation,
                userId,
                requestId);
        return rows.isEmpty() ? null : rows.getFirst();
    }

    private ExternalOperationRow requireOperation(UUID userId, UUID requestId) {
        ExternalOperationRow operation = findOperation(userId, requestId);
        if (operation == null) {
            throw new IllegalStateException("winning external operation is missing");
        }
        return operation;
    }

    private ExternalOperationRow requireOperation(UUID operationId) {
        List<ExternalOperationRow> rows = jdbc.query(
                operationSelect() + " WHERE id = ?",
                this::mapExternalOperation,
                operationId);
        if (rows.isEmpty()) {
            throw new IllegalStateException("inserted external operation is missing");
        }
        return rows.getFirst();
    }

    private PracticeSessionRow requireSession(UUID sessionId) {
        List<PracticeSessionRow> rows = jdbc.query("""
                SELECT
                    id,
                    user_id,
                    upload_intent_id,
                    status::text AS status,
                    situation,
                    character_context,
                    goal,
                    subtext,
                    blockage_kind,
                    sub_branch,
                    blockage_detail,
                    hidden_at,
                    created_at,
                    updated_at
                FROM practice_sessions
                WHERE id = ?
                """, this::mapPracticeSession, sessionId);
        if (rows.isEmpty()) {
            throw new IllegalStateException("practice session is missing");
        }
        return rows.getFirst();
    }

    private String operationSelect() {
        return """
                SELECT
                    id,
                    session_id,
                    user_id,
                    request_id,
                    kind::text AS kind,
                    status::text AS status,
                    attempt_count,
                    request_fingerprint,
                    lease_token,
                    lease_expires_at,
                    error_code,
                    response_payload::text AS response_payload,
                    created_at,
                    updated_at
                FROM external_operations
                """;
    }

    private PracticeSessionRow mapPracticeSession(ResultSet row, int rowNumber)
            throws SQLException {
        return new PracticeSessionRow(
                row.getObject("id", UUID.class),
                row.getObject("user_id", UUID.class),
                row.getObject("upload_intent_id", UUID.class),
                row.getString("status"),
                row.getString("situation"),
                row.getString("character_context"),
                row.getString("goal"),
                row.getString("subtext"),
                row.getString("blockage_kind"),
                row.getString("sub_branch"),
                row.getString("blockage_detail"),
                instant(row, "hidden_at"),
                instant(row, "created_at"),
                instant(row, "updated_at"));
    }

    private ExternalOperationRow mapExternalOperation(ResultSet row, int rowNumber)
            throws SQLException {
        return new ExternalOperationRow(
                row.getObject("id", UUID.class),
                row.getObject("session_id", UUID.class),
                row.getObject("user_id", UUID.class),
                row.getObject("request_id", UUID.class),
                row.getString("kind"),
                row.getString("status"),
                row.getInt("attempt_count"),
                row.getString("request_fingerprint"),
                row.getObject("lease_token", UUID.class),
                instant(row, "lease_expires_at"),
                row.getString("error_code"),
                json(row.getString("response_payload")),
                instant(row, "created_at"),
                instant(row, "updated_at"));
    }

    private static Instant instant(ResultSet row, String column) throws SQLException {
        OffsetDateTime value = row.getObject(column, OffsetDateTime.class);
        return value == null ? null : value.toInstant();
    }

    private JsonNode json(String value) throws SQLException {
        if (value == null) {
            return null;
        }
        try {
            return objectMapper.readTree(value);
        } catch (JsonProcessingException exc) {
            throw new SQLException("invalid JSONB value", exc);
        }
    }

    private static void validateSha256(String value) {
        if (value == null || value.length() != 64) {
            throw new IllegalArgumentException(SHA256_ERROR);
        }
        for (int index = 0; index < value.length(); index++) {
            if (Character.digit(value.charAt(index), 16) < 0) {
                throw new IllegalArgumentException(SHA256_ERROR);
            }
        }
    }
}
