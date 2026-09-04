package com.acttub.actingapi.feature.practice.adapter.db;

import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.practice.app.PracticeSessionRepository;
import com.acttub.actingapi.feature.practice.domain.AnalysisStatus;
import com.acttub.actingapi.feature.practice.domain.Observation;
import com.acttub.actingapi.feature.practice.domain.ObservationPack;
import com.acttub.actingapi.feature.practice.domain.PracticeSession;
import com.acttub.actingapi.feature.practice.domain.SessionDetail;
import com.acttub.actingapi.feature.practice.schema.PracticeSessionEntity;
import com.acttub.actingapi.platform.persistence.NativeTuples;
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
 * 기본 세션 읽기는 Spring Data로, 복합 projection·조건부 상태 전이는 native SQL로 구현한다.
 * JSONB를 도메인 타입으로 옮기는 일은 Jackson을 아는 이 Adapter에 남는다.
 */
@Repository
class PostgresPracticeSessionRepository implements PracticeSessionRepository {
    private final PracticeSessionJpaRepository sessions;
    private final EntityManager entityManager;
    private final ObjectMapper mapper;
    private final TransactionTemplate transaction;

    PostgresPracticeSessionRepository(
            PracticeSessionJpaRepository sessions,
            EntityManager entityManager,
            ObjectMapper mapper,
            PlatformTransactionManager transactionManager) {
        this.sessions = sessions;
        this.entityManager = entityManager;
        this.mapper = mapper;
        this.transaction = new TransactionTemplate(transactionManager);
        this.transaction.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    }

    @Override
    public boolean uploadExists(UUID userId, UUID uploadId) {
        return !NativeTuples.list(entityManager.createNativeQuery("""
                SELECT id AS id
                FROM upload_intents
                WHERE id = :uploadId AND user_id = :userId
                """, Tuple.class)
                .setParameter("uploadId", uploadId)
                .setParameter("userId", userId)).isEmpty();
    }

    @Override
    public PracticeSession find(UUID userId, UUID sessionId) {
        return sessions.findByIdAndUserIdAndHiddenAtIsNull(sessionId, userId)
                .map(PostgresPracticeSessionRepository::session)
                .orElse(null);
    }

    @Override
    public List<PracticeSession> list(UUID userId) {
        return sessions.findByUserIdAndHiddenAtIsNullOrderByCreatedAtDescIdDesc(userId)
                .stream()
                .map(PostgresPracticeSessionRepository::session)
                .toList();
    }

    @Override
    public UUID parentOf(UUID userId, UUID sessionId) {
        return sessions.findParent(userId, sessionId).orElse(null);
    }

    @Override
    public AnalysisStatus status(UUID userId, UUID sessionId) {
        List<Tuple> rows = NativeTuples.list(entityManager.createNativeQuery("""
                SELECT ps.status,
                    CASE WHEN ps.status = 'failed' THEN (
                        SELECT eo.error_code
                        FROM external_operations eo
                        WHERE eo.session_id = ps.id
                          AND eo.kind = 'analyze'
                        ORDER BY eo.created_at DESC, eo.id DESC
                        LIMIT 1
                    ) END AS error_code
                FROM practice_sessions ps
                WHERE ps.id = :sessionId
                  AND ps.user_id = :userId
                  AND ps.hidden_at IS NULL
                """, Tuple.class)
                .setParameter("sessionId", sessionId)
                .setParameter("userId", userId));
        if (rows.isEmpty()) {
            return null;
        }
        Tuple row = rows.getFirst();
        return new AnalysisStatus(
                row.get("status", String.class), row.get("error_code", String.class));
    }

    @Override
    public SessionDetail detail(UUID userId, UUID sessionId) {
        List<Tuple> rows = NativeTuples.list(entityManager.createNativeQuery("""
                SELECT
                    ps.id, ps.user_id, ps.upload_intent_id, ps.status,
                    ps.situation, ps.character_context, ps.goal, ps.blockage_kind,
                    ps.sub_branch, ps.blockage_detail, ps.continued_from,
                    ps.created_at, ps.updated_at,
                    ui.object_key,
                    summary.id AS summary_id,
                    summary.observations_json::text AS observations_json,
                    summary.uncertainties_json::text AS uncertainties_json,
                    operation.error_code
                FROM practice_sessions ps
                JOIN upload_intents ui ON ui.id = ps.upload_intent_id
                LEFT JOIN LATERAL (
                    SELECT s.id, s.observations_json, s.uncertainties_json
                    FROM summaries s
                    WHERE s.session_id = ps.id
                    ORDER BY s.created_at DESC, s.id DESC
                    LIMIT 1
                ) summary ON true
                LEFT JOIN LATERAL (
                    SELECT eo.error_code
                    FROM external_operations eo
                    WHERE eo.session_id = ps.id AND eo.kind = 'analyze'
                    ORDER BY eo.created_at DESC, eo.id DESC
                    LIMIT 1
                ) operation ON true
                WHERE ps.id = :sessionId
                  AND ps.user_id = :userId
                  AND ps.hidden_at IS NULL
                """, Tuple.class)
                .setParameter("sessionId", sessionId)
                .setParameter("userId", userId));
        return rows.isEmpty() ? null : detail(rows.getFirst());
    }

    @Override
    public boolean hide(UUID userId, UUID sessionId, OffsetDateTime now) {
        return Boolean.TRUE.equals(transaction.execute(status ->
                entityManager.createNativeQuery("""
                        UPDATE practice_sessions
                        SET hidden_at = :now, updated_at = :now
                        WHERE id = :sessionId
                          AND user_id = :userId
                          AND hidden_at IS NULL
                        """)
                        .setParameter("now", now)
                        .setParameter("sessionId", sessionId)
                        .setParameter("userId", userId)
                        .executeUpdate() > 0));
    }

    @Override
    public boolean resumeFailedOperation(UUID userId, UUID operationId, OffsetDateTime now) {
        return Boolean.TRUE.equals(transaction.execute(status -> {
            List<Tuple> rows = NativeTuples.list(entityManager.createNativeQuery("""
                    SELECT eo.session_id AS session_id
                    FROM external_operations eo
                    WHERE eo.id = :operationId
                      AND eo.user_id = :userId
                      AND eo.kind = 'analyze'
                      AND eo.status = 'failed'
                      AND eo.attempt_count < 3
                      AND eo.lease_token IS NULL
                    FOR UPDATE
                    """, Tuple.class)
                    .setParameter("operationId", operationId)
                    .setParameter("userId", userId));
            if (rows.isEmpty()) {
                return false;
            }
            UUID sessionId = rows.getFirst().get("session_id", UUID.class);
            int session = entityManager.createNativeQuery("""
                    UPDATE practice_sessions
                    SET status = 'analyzing', updated_at = :now
                    WHERE id = :sessionId
                      AND user_id = :userId
                      AND hidden_at IS NULL
                      AND status = 'failed'
                    """)
                    .setParameter("now", now)
                    .setParameter("sessionId", sessionId)
                    .setParameter("userId", userId)
                    .executeUpdate();
            if (session == 0) {
                return false;
            }
            entityManager.createNativeQuery("""
                    UPDATE external_operations
                    SET status = 'pending',
                        error_code = NULL,
                        response_payload = 'null'::jsonb,
                        updated_at = :now
                    WHERE id = :operationId
                    """)
                    .setParameter("now", now)
                    .setParameter("operationId", operationId)
                    .executeUpdate();
            return true;
        }));
    }

    private static PracticeSession session(PracticeSessionEntity entity) {
        return new PracticeSession(
                entity.getId(),
                entity.getUserId(),
                entity.getUploadIntentId(),
                entity.getStatus().dbValue(),
                entity.getSituation(),
                entity.getCharacterContext(),
                entity.getGoal(),
                entity.getBlockageKind(),
                entity.getSubBranch(),
                entity.getBlockageDetail(),
                entity.getContinuedFrom(),
                entity.getCreatedAt().atOffset(ZoneOffset.UTC),
                entity.getUpdatedAt().atOffset(ZoneOffset.UTC));
    }

    private static PracticeSession session(Tuple row) {
        return new PracticeSession(
                row.get("id", UUID.class),
                row.get("user_id", UUID.class),
                row.get("upload_intent_id", UUID.class),
                row.get("status", String.class),
                row.get("situation", String.class),
                row.get("character_context", String.class),
                row.get("goal", String.class),
                row.get("blockage_kind", String.class),
                row.get("sub_branch", String.class),
                row.get("blockage_detail", String.class),
                row.get("continued_from", UUID.class),
                row.get("created_at", Instant.class).atOffset(ZoneOffset.UTC),
                row.get("updated_at", Instant.class).atOffset(ZoneOffset.UTC));
    }

    /** 분석이 끝난 세션에 한해 Observation을 도메인 타입으로 옮긴다. */
    private SessionDetail detail(Tuple row) {
        PracticeSession session = session(row);
        UUID summaryId = row.get("summary_id", UUID.class);
        ObservationPack summary = summaryId == null || !session.analyzed() ? null
                : new ObservationPack(
                        summaryId,
                        observations(json(row.get("observations_json", String.class))),
                        uncertainties(json(row.get("uncertainties_json", String.class))));
        return new SessionDetail(
                session,
                row.get("object_key", String.class),
                summary,
                row.get("error_code", String.class));
    }

    private static List<Observation> observations(JsonNode node) {
        if (node == null) {
            return List.of();
        }
        List<Observation> items = new ArrayList<>();
        // what 은 SOMA-490 이 되살린 이름이고, label 은 그 이전에 저장된 관찰이다.
        // 화면 계약(label)은 그대로 두고 읽는 쪽에서만 둘 다 받는다.
        node.forEach(item -> items.add(new Observation(
                item.path("start_ms").bigIntegerValue(),
                item.path("end_ms").bigIntegerValue(),
                item.has("what") ? item.path("what").textValue() : item.path("label").textValue(),
                item.path("confidence").decimalValue())));
        return List.copyOf(items);
    }

    private static List<String> uncertainties(JsonNode node) {
        if (node == null) {
            return List.of();
        }
        List<String> values = new ArrayList<>();
        node.forEach(item -> values.add(item.textValue()));
        return List.copyOf(values);
    }

    private JsonNode json(String value) {
        if (value == null) {
            return null;
        }
        try {
            return mapper.readTree(value);
        } catch (JsonProcessingException exception) {
            throw new IllegalStateException("practice session contains invalid JSON", exception);
        }
    }
}
