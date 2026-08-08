package com.acttub.actingapi.practice;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

@Repository
class PracticeSessionStore {
    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;
    private final TransactionTemplate transaction;

    PracticeSessionStore(
            JdbcTemplate jdbc,
            ObjectMapper mapper,
            PlatformTransactionManager transactionManager) {
        this.jdbc = jdbc;
        this.mapper = mapper;
        this.transaction = new TransactionTemplate(transactionManager);
        this.transaction.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    }

    boolean uploadExists(UUID userId, UUID uploadId) {
        Integer found = jdbc.query("""
                SELECT 1 FROM upload_intents WHERE id=? AND user_id=?
                """, (row, number) -> 1, uploadId, userId).stream().findFirst().orElse(null);
        return found != null;
    }

    SessionRow find(UUID userId, UUID sessionId) {
        List<SessionRow> rows = jdbc.query(sessionSelect() + """
                WHERE ps.id=? AND ps.user_id=? AND ps.hidden_at IS NULL
                """, this::session, sessionId, userId);
        return rows.isEmpty() ? null : rows.getFirst();
    }

    List<SessionRow> list(UUID userId) {
        return jdbc.query(sessionSelect() + """
                WHERE ps.user_id=? AND ps.hidden_at IS NULL
                ORDER BY ps.created_at DESC, ps.id DESC
                """, this::session, userId);
    }

    StatusRow status(UUID userId, UUID sessionId) {
        List<StatusRow> rows = jdbc.query("""
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
                """, (row, number) -> new StatusRow(
                        row.getString("status"), row.getString("error_code")),
                sessionId, userId);
        return rows.isEmpty() ? null : rows.getFirst();
    }

    DetailRow detail(UUID userId, UUID sessionId) {
        List<DetailRow> rows = jdbc.query("""
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

    boolean hide(UUID userId, UUID sessionId, OffsetDateTime now) {
        return jdbc.update("""
                UPDATE practice_sessions SET hidden_at=?,updated_at=?
                WHERE id=? AND user_id=? AND hidden_at IS NULL
                """, now, now, sessionId, userId) > 0;
    }

    boolean resumeFailedOperation(UUID userId, UUID operationId, OffsetDateTime now) {
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
                        response_payload=NULL,updated_at=?
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
                    ps.sub_branch,ps.blockage_detail,ps.created_at,ps.updated_at
                FROM practice_sessions ps
                """;
    }

    private SessionRow session(ResultSet row, int number) throws SQLException {
        return new SessionRow(
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
                row.getObject("created_at", OffsetDateTime.class),
                row.getObject("updated_at", OffsetDateTime.class));
    }

    private DetailRow detail(ResultSet row, int number) throws SQLException {
        SessionRow session = session(row, number);
        UUID summaryId = row.getObject("summary_id", UUID.class);
        return new DetailRow(
                session,
                row.getString("object_key"),
                summaryId,
                json(row.getString("observations_json")),
                json(row.getString("uncertainties_json")),
                row.getString("error_code"));
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

    record SessionRow(
            UUID id,
            UUID userId,
            UUID uploadIntentId,
            String status,
            String situation,
            String characterContext,
            String goal,
            String blockageKind,
            String subBranch,
            String blockageDetail,
            OffsetDateTime createdAt,
            OffsetDateTime updatedAt) {
    }

    record StatusRow(String status, String errorCode) {
    }

    record DetailRow(
            SessionRow session,
            String objectKey,
            UUID summaryId,
            JsonNode observations,
            JsonNode uncertainties,
            String errorCode) {
    }

    private record ResumeRow(UUID sessionId) {
    }
}
