package com.acttub.actingapi.feature.practice.adapter.db;

import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.practice.app.PracticeOwnership;
import com.acttub.actingapi.feature.practice.app.PracticeSessionRepository;
import com.acttub.actingapi.feature.practice.domain.ObservationPack;
import com.acttub.actingapi.feature.practice.domain.PracticeSession;
import com.acttub.actingapi.feature.practice.domain.SessionDetail;
import com.acttub.actingapi.integration.observation.VideoRecord;
import com.acttub.actingapi.platform.persistence.NativeTuples;
import com.acttub.actingapi.integration.observation.StoredObservationPack;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Tuple;
import org.springframework.stereotype.Repository;

/**
 * 옛 {@code practice_sessions} 한 건을 native SQL projection 으로 읽는다.
 * JSONB를 도메인 타입으로 옮기는 일은 Jackson을 아는 이 Adapter에 남는다.
 */
@Repository
class PostgresPracticeSessionRepository implements PracticeSessionRepository, PracticeOwnership {
    private final EntityManager entityManager;
    private final ObjectMapper mapper;

    PostgresPracticeSessionRepository(EntityManager entityManager, ObjectMapper mapper) {
        this.entityManager = entityManager;
        this.mapper = mapper;
    }

    @Override
    public SessionDetail detail(UUID userId, UUID sessionId) {
        List<Tuple> rows = NativeTuples.list(entityManager.createNativeQuery("""
                SELECT
                    ps.id, ps.user_id, ps.upload_intent_id, ps.status,
                    ps.situation, ps.character_context, ps.goal, ps.blockage_kind,
                    ps.sub_branch, ps.blockage_detail, ps.continued_from, ps.experience_version,
                    ps.created_at, ps.updated_at,
                    ui.object_key,
                    summary.id AS summary_id,
                    summary.raw::text AS raw_json,
                    summary.observations_json::text AS observations_json,
                    summary.uncertainties_json::text AS uncertainties_json,
                    operation.error_code
                FROM practice_sessions ps
                JOIN upload_intents ui ON ui.id = ps.upload_intent_id
                LEFT JOIN LATERAL (
                    SELECT s.id, s.raw, s.observations_json, s.uncertainties_json
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

    /**
     * 분석·대화·노트는 연습 행에 매달려 함께 따라간다.
     *
     * <p>⚠ <b>트랜잭션을 따로 열지 않는다.</b> {@code REQUIRES_NEW} 로 열면 이관의 트랜잭션과 따로 커밋돼,
     * 이관이 도중에 실패해도 연습만 회원에게 넘어간 채로 남는다. 부르는 쪽에 트랜잭션이 없으면
     * {@code executeUpdate} 가 거절한다.
     */
    @Override
    public void reassign(UUID from, UUID to) {
        // 옛 표와 0.1.0 회차를 함께 옮긴다 — 이관은 한 트랜잭션이고 게스트가 어느 흐름으로 연습했는지는
        // 이관이 알 바가 아니다. 분석·대화·노트는 회차에 매달려 따라간다(specs/practice 「이관·삭제·탈퇴」).
        for (String table : List.of("practice_sessions", "practices")) {
            entityManager.createNativeQuery(
                    "UPDATE " + table + " SET user_id = :to WHERE user_id = :from")
                    .setParameter("to", to)
                    .setParameter("from", from)
                    .executeUpdate();
        }
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
                row.get("updated_at", Instant.class).atOffset(ZoneOffset.UTC), row.get("experience_version", String.class));
    }

    /** 분석이 끝난 세션에 한해 Observation을 도메인 타입으로 옮긴다. */
    private SessionDetail detail(Tuple row) {
        PracticeSession session = session(row);
        UUID summaryId = row.get("summary_id", UUID.class);
        JsonNode pack = StoredObservationPack.read(
                json(row.get("raw_json", String.class)),
                json(row.get("observations_json", String.class)),
                json(row.get("uncertainties_json", String.class)));
        if (summaryId != null && session.analyzed() && VideoRecord.isRecord(pack)) {
            return new SessionDetail(session, row.get("object_key", String.class), null,
                    row.get("error_code", String.class), PracticeAnalysisMapper.recordSummary(pack));
        }
        ObservationPack summary = summaryId == null || !session.analyzed() ? null
                : new ObservationPack(
                        summaryId,
                        PracticeAnalysisMapper.observations(pack.path("observations")),
                        PracticeAnalysisMapper.uncertainties(pack.path("uncertainties")));
        return new SessionDetail(
                session,
                row.get("object_key", String.class),
                summary,
                row.get("error_code", String.class));
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
