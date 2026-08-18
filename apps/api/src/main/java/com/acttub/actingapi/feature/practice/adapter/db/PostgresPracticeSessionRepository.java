package com.acttub.actingapi.feature.practice.adapter.db;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.practice.app.PracticeSessionRepository;
import com.acttub.actingapi.feature.practice.domain.AnalysisStatus;
import com.acttub.actingapi.feature.practice.domain.Observation;
import com.acttub.actingapi.feature.practice.domain.ObservationPack;
import com.acttub.actingapi.feature.practice.domain.PracticeSession;
import com.acttub.actingapi.feature.practice.domain.SessionDetail;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 손으로 쓴 SQL 로 포트를 구현한다. JPA 로 가지 않는 이유는 SPEC §5-5 에 있다 — Schema Entity 는
 * {@code ddl-auto: validate} 의 대조 대상일 뿐 호출되지 않는다.
 *
 * <p>JSONB 를 도메인 타입으로 옮기는 일이 여기 있다. 안쪽은 Jackson 을 모르므로, 트리를 읽어
 * {@link Observation} 으로 바꾸는 것이 이 어댑터의 몫이다.
 */
@Repository
class PostgresPracticeSessionRepository implements PracticeSessionRepository {
    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;
    private final TransactionTemplate transaction;

    PostgresPracticeSessionRepository(
            JdbcTemplate jdbc,
            ObjectMapper mapper,
            PlatformTransactionManager transactionManager) {
        this.jdbc = jdbc;
        this.mapper = mapper;
        this.transaction = new TransactionTemplate(transactionManager);
        this.transaction.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    }

    @Override
    public boolean uploadExists(UUID userId, UUID uploadId) {
        Integer found = jdbc.query("""
                SELECT 1 FROM upload_intents WHERE id=? AND user_id=?
                """, (row, number) -> 1, uploadId, userId).stream().findFirst().orElse(null);
        return found != null;
    }

    @Override
    public PracticeSession find(UUID userId, UUID sessionId) {
        List<PracticeSession> rows = jdbc.query(sessionSelect() + """
                WHERE ps.id=? AND ps.user_id=? AND ps.hidden_at IS NULL
                """, this::session, sessionId, userId);
        return rows.isEmpty() ? null : rows.getFirst();
    }

    @Override
    public List<PracticeSession> list(UUID userId) {
        return jdbc.query(sessionSelect() + """
                WHERE ps.user_id=? AND ps.hidden_at IS NULL
                ORDER BY ps.created_at DESC, ps.id DESC
                """, this::session, userId);
    }

    @Override
    public UUID parentOf(UUID userId, UUID sessionId) {
        List<UUID> rows = jdbc.query("""
                SELECT ps.continued_from
                FROM practice_sessions ps
                WHERE ps.id=? AND ps.user_id=? AND ps.hidden_at IS NULL
                """, (row, number) -> row.getObject("continued_from", UUID.class),
                sessionId, userId);
        return rows.isEmpty() ? null : rows.getFirst();
    }

    @Override
    public AnalysisStatus status(UUID userId, UUID sessionId) {
        List<AnalysisStatus> rows = jdbc.query("""
                SELECT ps.status::text AS status,
                    CASE WHEN ps.status='failed'::practice_status_t THEN (
                        SELECT eo.error_code
                        FROM external_operations eo
                        WHERE eo.session_id=ps.id
                          AND eo.kind='analyze'::operation_kind_t
                        ORDER BY eo.created_at DESC,eo.id DESC
                        LIMIT 1
                    ) END AS error_code
                FROM practice_sessions ps
                WHERE ps.id=? AND ps.user_id=? AND ps.hidden_at IS NULL
                """, (row, number) -> new AnalysisStatus(
                        row.getString("status"), row.getString("error_code")),
                sessionId, userId);
        return rows.isEmpty() ? null : rows.getFirst();
    }

    @Override
    public SessionDetail detail(UUID userId, UUID sessionId) {
        List<SessionDetail> rows = jdbc.query("""
                SELECT
                    ps.id,ps.user_id,ps.upload_intent_id,ps.status::text AS status,
                    ps.situation,ps.character_context,ps.goal,ps.blockage_kind,
                    ps.sub_branch,ps.blockage_detail,ps.created_at,ps.updated_at,
                    ui.object_key,
                    summary.id AS summary_id,
                    summary.observations_json::text AS observations_json,
                    summary.uncertainties_json::text AS uncertainties_json,
                    operation.error_code
                FROM practice_sessions ps
                JOIN upload_intents ui ON ui.id=ps.upload_intent_id
                LEFT JOIN LATERAL (
                    SELECT s.id,s.observations_json,s.uncertainties_json
                    FROM summaries s WHERE s.session_id=ps.id
                    ORDER BY s.created_at DESC,s.id DESC LIMIT 1
                ) summary ON true
                LEFT JOIN LATERAL (
                    SELECT eo.error_code
                    FROM external_operations eo
                    WHERE eo.session_id=ps.id AND eo.kind='analyze'::operation_kind_t
                    ORDER BY eo.created_at DESC,eo.id DESC LIMIT 1
                ) operation ON true
                WHERE ps.id=? AND ps.user_id=? AND ps.hidden_at IS NULL
                """, this::detail, sessionId, userId);
        return rows.isEmpty() ? null : rows.getFirst();
    }

    @Override
    public boolean hide(UUID userId, UUID sessionId, OffsetDateTime now) {
        return jdbc.update("""
                UPDATE practice_sessions SET hidden_at=?,updated_at=?
                WHERE id=? AND user_id=? AND hidden_at IS NULL
                """, now, now, sessionId, userId) > 0;
    }

    @Override
    public boolean resumeFailedOperation(UUID userId, UUID operationId, OffsetDateTime now) {
        Boolean resumed = transaction.execute(status -> {
            List<ResumeRow> rows = jdbc.query("""
                    SELECT eo.session_id
                    FROM external_operations eo
                    WHERE eo.id=? AND eo.user_id=?
                      AND eo.kind='analyze'::operation_kind_t
                      AND eo.status='failed'::operation_status_t
                      AND eo.attempt_count<3 AND eo.lease_token IS NULL
                    FOR UPDATE
                    """, (row, number) -> new ResumeRow(row.getObject("session_id", UUID.class)),
                    operationId, userId);
            if (rows.isEmpty()) {
                return false;
            }
            UUID sessionId = rows.getFirst().sessionId();
            int session = jdbc.update("""
                    UPDATE practice_sessions
                    SET status='analyzing'::practice_status_t,updated_at=?
                    WHERE id=? AND user_id=? AND hidden_at IS NULL
                      AND status='failed'::practice_status_t
                    """, now, sessionId, userId);
            if (session == 0) {
                return false;
            }
            jdbc.update("""
                    UPDATE external_operations
                    SET status='pending'::operation_status_t,error_code=NULL,
                        -- SQLAlchemy JSONB None과 같은 JSON 리터럴 null이다.
                        response_payload='null'::jsonb,updated_at=?
                    WHERE id=?
                    """, now, operationId);
            return true;
        });
        return Boolean.TRUE.equals(resumed);
    }

    private String sessionSelect() {
        return """
                SELECT ps.id,ps.user_id,ps.upload_intent_id,ps.status::text AS status,
                    ps.situation,ps.character_context,ps.goal,ps.blockage_kind,
                    ps.sub_branch,ps.blockage_detail,ps.continued_from,
                    ps.created_at,ps.updated_at
                FROM practice_sessions ps
                """;
    }

    private PracticeSession session(ResultSet row, int number) throws SQLException {
        return new PracticeSession(
                row.getObject("id", UUID.class),
                row.getObject("user_id", UUID.class),
                row.getObject("upload_intent_id", UUID.class),
                row.getString("status"),
                row.getString("situation"),
                row.getString("character_context"),
                row.getString("goal"),
                row.getString("blockage_kind"),
                row.getString("sub_branch"),
                row.getString("blockage_detail"),
                row.getObject("continued_from", UUID.class),
                row.getObject("created_at", OffsetDateTime.class),
                row.getObject("updated_at", OffsetDateTime.class));
    }

    /**
     * 요약을 <b>분석이 끝난 세션에 한해</b> 도메인 타입으로 옮긴다.
     *
     * <p>실패했다가 재분석 중인 세션에도 지난 요약 행이 남아 있는데, 그것은 어차피 응답에 실리지
     * 않는다(서비스가 상태를 보고 버린다). 그런 행까지 여기서 읽으면 <b>보여주지도 않을 데이터의
     * 흠결이 500 이 되어 새어 나온다</b> — 옮기기 전에는 컨트롤러가 상태를 본 다음에야 변환했으므로
     * 그 경로가 없었다.
     */
    private SessionDetail detail(ResultSet row, int number) throws SQLException {
        PracticeSession session = session(row, number);
        UUID summaryId = row.getObject("summary_id", UUID.class);
        ObservationPack summary = summaryId == null || !session.analyzed() ? null
                : new ObservationPack(
                        summaryId,
                        observations(json(row.getString("observations_json"))),
                        uncertainties(json(row.getString("uncertainties_json"))));
        return new SessionDetail(
                session,
                row.getString("object_key"),
                summary,
                row.getString("error_code"));
    }

    /**
     * 관찰 배열을 읽는다. 키가 없으면 파이썬과 같이 빈 값으로 떨어진다 —
     * {@code path} 는 없는 키에 대해 결측 노드를 주고, 그 노드는 0 과 {@code null} 로 읽힌다.
     */
    private static List<Observation> observations(JsonNode node) {
        if (node == null) {
            return List.of();
        }
        List<Observation> items = new ArrayList<>();
        node.forEach(item -> items.add(new Observation(
                item.path("start_ms").bigIntegerValue(),
                item.path("end_ms").bigIntegerValue(),
                item.path("label").textValue(),
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

    private JsonNode json(String value) throws SQLException {
        if (value == null) {
            return null;
        }
        try {
            return mapper.readTree(value);
        } catch (JsonProcessingException exception) {
            throw new SQLException("invalid JSONB value", exception);
        }
    }

    private record ResumeRow(UUID sessionId) {
    }
}
