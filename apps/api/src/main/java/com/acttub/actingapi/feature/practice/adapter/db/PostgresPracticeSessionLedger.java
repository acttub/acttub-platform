package com.acttub.actingapi.feature.practice.adapter.db;

import static com.acttub.actingapi.platform.persistence.NativeTuples.list;

import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.practice.app.ExternalOperationRow;
import com.acttub.actingapi.feature.practice.app.PracticeSessionLedger;
import com.acttub.actingapi.feature.practice.app.PracticeSessionOperation;
import com.acttub.actingapi.feature.practice.app.PracticeSessionRow;
import com.acttub.actingapi.feature.practice.schema.PracticeSessionEntity;
import com.acttub.actingapi.platform.schema.PracticeStatus;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Tuple;
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

    private final EntityManager entityManager;
    private final ObjectMapper objectMapper;
    private final TransactionTemplate transactionTemplate;

    public PostgresPracticeSessionLedger(
            EntityManager entityManager,
            ObjectMapper objectMapper,
            PlatformTransactionManager transactionManager) {
        this.entityManager = entityManager;
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
            UUID continuedFrom,
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
                continuedFrom,
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
            UUID continuedFrom,
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
        PracticeSessionEntity session = new PracticeSessionEntity(
                sessionId,
                userId,
                uploadIntentId,
                PracticeStatus.ANALYZING,
                situation,
                characterContext,
                null,
                blockageKind,
                subBranch,
                blockageDetail,
                goal,
                continuedFrom);
        entityManager.persist(session);
        entityManager.flush();

        UUID operationId = insertAnalyzeOperation(
                sessionId, userId, requestId, requestFingerprint);
        if (operationId == null) {
            entityManager.remove(session);
            entityManager.flush();
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

        entityManager.createNativeQuery("""
                UPDATE practice_sessions
                SET status = 'analyzing',
                    updated_at = :retriedAt
                WHERE id = :sessionId
                """)
                .setParameter("retriedAt", retriedAt)
                .setParameter("sessionId", sessionId)
                .executeUpdate();

        return new PracticeSessionOperation(
                requireSession(sessionId),
                requireOperation(operationId),
                true,
                false);
    }

    private boolean lockFinalizedUpload(UUID userId, UUID uploadIntentId) {
        List<Tuple> rows = list(entityManager.createNativeQuery("""
                SELECT id AS id
                FROM upload_intents
                WHERE id = :uploadIntentId
                  AND user_id = :userId
                  AND status = 'finalized'
                FOR UPDATE
                """, Tuple.class)
                .setParameter("uploadIntentId", uploadIntentId)
                .setParameter("userId", userId));
        return !rows.isEmpty();
    }

    private PracticeSessionRow lockVisibleSession(UUID userId, UUID sessionId) {
        List<Tuple> rows = list(entityManager.createNativeQuery(sessionSelect() + """
                WHERE id = :sessionId
                  AND user_id = :userId
                  AND hidden_at IS NULL
                FOR UPDATE
                """, Tuple.class)
                .setParameter("sessionId", sessionId)
                .setParameter("userId", userId));
        return rows.isEmpty() ? null : practiceSession(rows.getFirst());
    }

    private UUID insertAnalyzeOperation(
            UUID sessionId,
            UUID userId,
            UUID requestId,
            String requestFingerprint) {
        UUID operationId = UUID.randomUUID();
        List<Tuple> inserted = list(entityManager.createNativeQuery("""
                WITH inserted AS (
                    INSERT INTO external_operations (
                        id,
                        session_id,
                        user_id,
                        request_id,
                        kind,
                        request_fingerprint
                    )
                    VALUES (
                        :operationId,
                        :sessionId,
                        :userId,
                        :requestId,
                        'analyze',
                        :requestFingerprint
                    )
                    ON CONFLICT (user_id, request_id) DO NOTHING
                    RETURNING id
                )
                SELECT id FROM inserted
                """, Tuple.class)
                .setParameter("operationId", operationId)
                .setParameter("sessionId", sessionId)
                .setParameter("userId", userId)
                .setParameter("requestId", requestId)
                .setParameter("requestFingerprint", requestFingerprint));
        return inserted.isEmpty() ? null : inserted.getFirst().get("id", UUID.class);
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
        List<Tuple> rows = list(entityManager.createNativeQuery(
                operationSelect() + " WHERE user_id = :userId AND request_id = :requestId",
                Tuple.class)
                .setParameter("userId", userId)
                .setParameter("requestId", requestId));
        return rows.isEmpty() ? null : externalOperation(rows.getFirst());
    }

    private ExternalOperationRow requireOperation(UUID userId, UUID requestId) {
        ExternalOperationRow operation = findOperation(userId, requestId);
        if (operation == null) {
            throw new IllegalStateException("winning external operation is missing");
        }
        return operation;
    }

    private ExternalOperationRow requireOperation(UUID operationId) {
        List<Tuple> rows = list(entityManager.createNativeQuery(
                operationSelect() + " WHERE id = :operationId", Tuple.class)
                .setParameter("operationId", operationId));
        if (rows.isEmpty()) {
            throw new IllegalStateException("inserted external operation is missing");
        }
        return externalOperation(rows.getFirst());
    }

    private PracticeSessionRow requireSession(UUID sessionId) {
        List<Tuple> rows = list(entityManager.createNativeQuery(
                sessionSelect() + " WHERE id = :sessionId", Tuple.class)
                .setParameter("sessionId", sessionId));
        if (rows.isEmpty()) {
            throw new IllegalStateException("practice session is missing");
        }
        return practiceSession(rows.getFirst());
    }

    private static String sessionSelect() {
        return """
                SELECT
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
                    blockage_detail,
                    hidden_at,
                    created_at,
                    updated_at
                FROM practice_sessions
                """;
    }

    private static String operationSelect() {
        return """
                SELECT
                    id,
                    session_id,
                    user_id,
                    request_id,
                    kind,
                    status,
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

    private static PracticeSessionRow practiceSession(Tuple row) {
        return new PracticeSessionRow(
                row.get("id", UUID.class),
                row.get("user_id", UUID.class),
                row.get("upload_intent_id", UUID.class),
                row.get("status", String.class),
                row.get("situation", String.class),
                row.get("character_context", String.class),
                row.get("goal", String.class),
                row.get("subtext", String.class),
                row.get("blockage_kind", String.class),
                row.get("sub_branch", String.class),
                row.get("blockage_detail", String.class),
                row.get("hidden_at", Instant.class),
                row.get("created_at", Instant.class),
                row.get("updated_at", Instant.class));
    }

    private ExternalOperationRow externalOperation(Tuple row) {
        return new ExternalOperationRow(
                row.get("id", UUID.class),
                row.get("session_id", UUID.class),
                row.get("user_id", UUID.class),
                row.get("request_id", UUID.class),
                row.get("kind", String.class),
                row.get("status", String.class),
                row.get("attempt_count", Integer.class),
                row.get("request_fingerprint", String.class),
                row.get("lease_token", UUID.class),
                row.get("lease_expires_at", Instant.class),
                row.get("error_code", String.class),
                json(row.get("response_payload", String.class)),
                row.get("created_at", Instant.class),
                row.get("updated_at", Instant.class));
    }

    private JsonNode json(String value) {
        if (value == null) {
            return null;
        }
        try {
            return objectMapper.readTree(value);
        } catch (JsonProcessingException exception) {
            throw new IllegalStateException("external operation contains invalid JSON", exception);
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
