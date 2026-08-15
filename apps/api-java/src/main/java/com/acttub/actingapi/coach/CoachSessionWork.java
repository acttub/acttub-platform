package com.acttub.actingapi.coach;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.operation.LeaseOwnershipException;
import com.acttub.actingapi.report.OwnedReportSource;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * Coach-session 저장 연산의 트랜잭션 내부 작업.
 *
 * <p>이 클래스에는 의도적으로 {@code @Transactional}이 없다. 모든 메서드는
 * {@link CoachSessionStore} 또는 이후 M4 caller가 연 트랜잭션에 참여한다.
 */
@Component
public class CoachSessionWork {

    private final JdbcTemplate jdbc;
    private final ObjectMapper objectMapper;

    public CoachSessionWork(JdbcTemplate jdbc, ObjectMapper objectMapper) {
        this.jdbc = jdbc;
        this.objectMapper = objectMapper;
    }

    public CoachSessionSnapshot loadSession(
            UUID sessionId,
            UUID userId,
            boolean includeHidden) {
        StringBuilder sql = new StringBuilder("""
                SELECT
                    cs.id AS coach_session_id,
                    cs.summary_id,
                    cs.status::text AS coach_status,
                    cs.close_reason::text AS close_reason,
                    cs.conversation_summary,
                    s.observations_json::text AS observations_json,
                    s.uncertainties_json::text AS uncertainties_json,
                    ps.id AS practice_session_id,
                    ps.user_id,
                    ps.situation,
                    ps.character_context,
                    ps.goal,
                    ps.blockage_kind,
                    ps.sub_branch,
                    ps.blockage_detail,
                    ps.upload_intent_id,
                    ui.duration_ms
                FROM coach_sessions cs
                JOIN practice_sessions ps ON ps.id = cs.practice_session_id
                LEFT JOIN summaries s ON s.session_id = ps.id
                JOIN upload_intents ui ON ui.id = ps.upload_intent_id
                WHERE cs.id = ?
                """);
        List<Object> arguments = new ArrayList<>();
        arguments.add(sessionId);
        if (userId != null) {
            sql.append(" AND ps.user_id = ?\n");
            arguments.add(userId);
        }
        if (!includeHidden) {
            sql.append(" AND ps.hidden_at IS NULL\n");
        }
        sql.append(" FOR SHARE OF cs");

        List<SessionRow> rows = jdbc.query(
                sql.toString(),
                this::mapSessionRow,
                arguments.toArray());
        if (rows.isEmpty()) {
            return null;
        }

        SessionRow row = rows.getFirst();
        List<CoachTurnSnapshot> turns = jdbc.query("""
                SELECT role::text AS role, text
                FROM coach_turns
                WHERE session_id = ?
                ORDER BY turn_index
                """,
                (result, rowNumber) -> new CoachTurnSnapshot(
                        result.getString("role"),
                        result.getString("text")),
                sessionId);
        List<String> transcripts = jdbc.queryForList("""
                SELECT text
                FROM transcripts
                WHERE session_id = ?
                ORDER BY ord
                """, String.class, row.practiceSessionId());
        JsonNode analysisHandoff = "표현".equals(row.blockageKind())
                ? findConfirmedAnalysisHandoff(row.userId(), row.uploadIntentId())
                : null;

        return new CoachSessionSnapshot(
                sessionId,
                row.practiceSessionId(),
                row.summaryId(),
                row.userId(),
                observationPack(row),
                row.situation(),
                row.characterContext(),
                row.goal(),
                row.durationMs() == null ? 0 : row.durationMs(),
                row.blockageKind(),
                row.subBranch(),
                row.blockageDetail(),
                transcripts,
                row.conversationSummary(),
                analysisHandoff,
                row.status(),
                row.closeReason() == null ? "" : row.closeReason(),
                turns);
    }

    public void saveCoachSession(CoachSessionSnapshot session, OffsetDateTime now) {
        List<String> statuses = jdbc.queryForList("""
                SELECT status::text
                FROM coach_sessions
                WHERE id = ?
                FOR UPDATE
                """, String.class, session.sessionId());
        if (statuses.isEmpty()) {
            throw new LookupError("session not found");
        }

        List<CoachTurnSnapshot> storedTurns = jdbc.query("""
                SELECT role::text AS role, text
                FROM coach_turns
                WHERE session_id = ?
                ORDER BY turn_index
                """,
                (row, rowNumber) -> new CoachTurnSnapshot(
                        row.getString("role"),
                        row.getString("text")),
                session.sessionId());
        if (session.turns().size() < storedTurns.size()) {
            throw new SessionWriteConflict("session turns are stale");
        }
        for (int index = 0; index < storedTurns.size(); index++) {
            if (!storedTurns.get(index).equals(session.turns().get(index))) {
                throw new SessionWriteConflict("session turns changed concurrently");
            }
        }
        if ("closed".equals(statuses.getFirst())
                && (!"closed".equals(session.status())
                        || session.turns().size() > storedTurns.size())) {
            throw new SessionWriteConflict("closed session changed concurrently");
        }

        for (int index = storedTurns.size(); index < session.turns().size(); index++) {
            CoachTurnSnapshot turn = session.turns().get(index);
            jdbc.update("""
                    INSERT INTO coach_turns (session_id, turn_index, role, text)
                    VALUES (?, ?, ?::turn_role_t, ?)
                    """,
                    session.sessionId(),
                    index,
                    turn.role(),
                    turn.text());
        }
        jdbc.update("""
                UPDATE coach_sessions
                SET status = ?::session_status_t,
                    conversation_summary = ?,
                    updated_at = ?
                WHERE id = ?
                """,
                session.status(),
                session.conversationSummary(),
                now,
                session.sessionId());
    }

    public UUID findOldestOpenCoachSessionId(UUID userId, UUID practiceSessionId) {
        List<UUID> ids = jdbc.queryForList("""
                SELECT cs.id
                FROM coach_sessions cs
                JOIN practice_sessions ps ON ps.id = cs.practice_session_id
                WHERE cs.practice_session_id = ?
                  AND cs.status = 'open'::session_status_t
                  AND ps.user_id = ?
                  AND ps.hidden_at IS NULL
                ORDER BY cs.created_at, cs.id
                LIMIT 1
                """, UUID.class, practiceSessionId, userId);
        return ids.isEmpty() ? null : ids.getFirst();
    }

    public String practiceSessionStatus(UUID userId, UUID practiceSessionId) {
        List<String> values = jdbc.queryForList("""
                SELECT status::text
                FROM practice_sessions
                WHERE id = ? AND user_id = ? AND hidden_at IS NULL
                """, String.class, practiceSessionId, userId);
        return values.isEmpty() ? null : values.getFirst();
    }

    public OwnedPracticeSessionContext ownedPracticeSessionContext(
            UUID userId, UUID practiceSessionId) {
        List<PracticeContextRow> rows = jdbc.query("""
                SELECT
                    ps.id AS practice_session_id,
                    ps.user_id,
                    ps.situation,
                    ps.character_context,
                    ps.goal,
                    ps.blockage_kind,
                    ps.sub_branch,
                    ps.blockage_detail,
                    ps.upload_intent_id,
                    ui.duration_ms,
                    s.id AS summary_id,
                    s.observations_json::text AS observations_json,
                    s.uncertainties_json::text AS uncertainties_json
                FROM practice_sessions ps
                JOIN upload_intents ui ON ui.id = ps.upload_intent_id
                LEFT JOIN summaries s ON s.session_id = ps.id
                WHERE ps.id = ? AND ps.user_id = ? AND ps.hidden_at IS NULL
                """, (row, number) -> new PracticeContextRow(
                row.getObject("practice_session_id", UUID.class),
                row.getObject("user_id", UUID.class),
                row.getString("situation"),
                row.getString("character_context"),
                row.getString("goal"),
                row.getString("blockage_kind"),
                row.getString("sub_branch"),
                row.getString("blockage_detail"),
                row.getObject("upload_intent_id", UUID.class),
                row.getObject("duration_ms", Integer.class),
                row.getObject("summary_id", UUID.class),
                parseJson(row.getString("observations_json")),
                parseJson(row.getString("uncertainties_json"))),
                practiceSessionId,
                userId);
        if (rows.isEmpty()) {
            return null;
        }
        PracticeContextRow row = rows.getFirst();
        ObjectNode pack = null;
        if (row.summaryId() != null) {
            pack = objectMapper.createObjectNode();
            pack.set("observations", row.observations());
            pack.set("uncertainties", row.uncertainties());
        }
        List<String> transcripts = jdbc.queryForList("""
                SELECT text FROM transcripts WHERE session_id = ? ORDER BY ord
                """, String.class, practiceSessionId);
        JsonNode analysisHandoff = "표현".equals(row.blockageKind())
                ? findConfirmedAnalysisHandoff(row.userId(), row.uploadIntentId())
                : null;
        return new OwnedPracticeSessionContext(
                row.practiceSessionId(),
                row.summaryId(),
                row.userId(),
                pack,
                row.situation(),
                row.characterContext(),
                row.goal(),
                row.durationMs() == null ? 0 : row.durationMs(),
                row.blockageKind(),
                row.subBranch(),
                row.blockageDetail(),
                transcripts,
                analysisHandoff);
    }

    public boolean hasReportForPracticeSession(UUID practiceSessionId) {
        Boolean value = jdbc.queryForObject("""
                SELECT EXISTS (
                    SELECT 1 FROM practice_reports WHERE practice_session_id = ?
                )
                """, Boolean.class, practiceSessionId);
        return Boolean.TRUE.equals(value);
    }

    public JsonNode practiceReportForHandoff(UUID handoffId) {
        List<String> values = jdbc.queryForList("""
                SELECT report_json::text
                FROM practice_reports
                WHERE source_handoff_id = ?
                """, String.class, handoffId);
        return values.isEmpty() ? null : parseJson(values.getFirst());
    }

    public void addCoachSession(CoachSessionSnapshot session) {
        jdbc.update("""
                INSERT INTO coach_sessions (
                    id,
                    practice_session_id,
                    summary_id,
                    status,
                    close_reason,
                    conversation_summary
                )
                VALUES (?, ?, ?, ?::session_status_t, NULL, ?)
                """,
                session.sessionId(),
                session.practiceSessionId(),
                session.summaryId(),
                session.status(),
                session.conversationSummary());
        for (int index = 0; index < session.turns().size(); index++) {
            CoachTurnSnapshot turn = session.turns().get(index);
            jdbc.update("""
                    INSERT INTO coach_turns (session_id, turn_index, role, text)
                    VALUES (?, ?, ?::turn_role_t, ?)
                    """,
                    session.sessionId(),
                    index,
                    turn.role(),
                    turn.text());
        }
    }

    public int closeOpenCoachSessions(UUID practiceSessionId, OffsetDateTime now) {
        return jdbc.update("""
                UPDATE coach_sessions
                SET status = 'closed'::session_status_t,
                    updated_at = ?
                WHERE practice_session_id = ?
                  AND status = 'open'::session_status_t
                """, now, practiceSessionId);
    }

    public OwnedReportSource ownedReportSource(UUID userId, UUID coachSessionId) {
        CoachSessionSnapshot session = loadSession(coachSessionId, userId, false);
        if (session == null) {
            return null;
        }

        List<HandoffRow> latest = jdbc.query("""
                SELECT
                    h.id,
                    h.branch_kind,
                    h.handoff_json::text AS handoff_json,
                    c.confirmed
                FROM coaching_handoffs h
                LEFT JOIN handoff_confirmations c ON c.coaching_handoff_id = h.id
                WHERE h.coach_session_id = ?
                ORDER BY h.created_at DESC, h.id DESC
                LIMIT 1
                """, this::mapHandoff, coachSessionId);
        HandoffRow handoff = latest.isEmpty() ? null : latest.getFirst();
        String branchKind = handoff == null
                ? ("표현".equals(session.blockageKind()) ? "expression" : "analysis")
                : handoff.branchKind();

        HandoffRow analysis = null;
        if ("expression".equals(branchKind)) {
            List<HandoffRow> rows = jdbc.query("""
                    SELECT
                        h.id,
                        h.branch_kind,
                        h.handoff_json::text AS handoff_json,
                        c.confirmed
                    FROM coaching_handoffs h
                    JOIN handoff_confirmations c ON c.coaching_handoff_id = h.id
                    WHERE h.practice_session_id = ?
                      AND h.branch_kind = 'analysis'
                      AND c.confirmed IS TRUE
                    ORDER BY h.created_at DESC, h.id DESC
                    LIMIT 1
                    """, this::mapHandoff, session.practiceSessionId());
            analysis = rows.isEmpty() ? null : rows.getFirst();
        }

        return new OwnedReportSource(
                session.practiceSessionId(),
                session.sessionId(),
                session.observationPack() == null ? emptyObservationPack() : session.observationPack(),
                branchKind,
                handoff == null ? null : handoff.id(),
                handoff == null ? null : handoff.json(),
                handoff != null && Boolean.TRUE.equals(handoff.confirmed()),
                analysis == null ? null : analysis.id(),
                analysis == null ? null : analysis.json());
    }

    public void upsertHandoffConfirmation(
            UUID handoffId,
            boolean confirmed,
            String rebuttalText,
            OffsetDateTime now) {
        jdbc.update("""
                INSERT INTO handoff_confirmations (
                    coaching_handoff_id,
                    confirmed,
                    rebuttal_text,
                    updated_at
                )
                VALUES (?, ?, ?, ?)
                ON CONFLICT (coaching_handoff_id) DO UPDATE
                SET confirmed = EXCLUDED.confirmed,
                    rebuttal_text = EXCLUDED.rebuttal_text,
                    updated_at = EXCLUDED.updated_at
                """, handoffId, confirmed, rebuttalText, now);
    }

    public void closeCoachSession(UUID coachSessionId, OffsetDateTime now) {
        jdbc.update("""
                UPDATE coach_sessions
                SET status = 'closed'::session_status_t,
                    updated_at = ?
                WHERE id = ?
                """, now, coachSessionId);
    }

    public OperationRow requireCoachStartOperation(UUID operationId) {
        return requireOperation(operationId, "coach_start", "coach start");
    }

    public OperationRow requireCoachReplyOperation(UUID operationId) {
        return requireOperation(operationId, "coach_reply", "coach reply");
    }

    private OperationRow requireOperation(
            UUID operationId, String expectedKind, String label) {
        List<OperationRow> rows = jdbc.query("""
                SELECT session_id, kind::text AS kind
                FROM external_operations
                WHERE id = ?
                """,
                (row, rowNumber) -> new OperationRow(
                        row.getObject("session_id", UUID.class),
                        row.getString("kind")),
                operationId);
        if (rows.isEmpty()) {
            throw new LookupError("external operation not found");
        }
        OperationRow operation = rows.getFirst();
        if (!expectedKind.equals(operation.kind())) {
            throw new IllegalArgumentException(
                    label + " result requires a " + expectedKind + " operation");
        }
        return operation;
    }

    public void addHandoff(
            UUID handoffId,
            UUID coachSessionId,
            UUID practiceSessionId,
            String branchKind,
            JsonNode handoffJson,
            boolean confirmed,
            OffsetDateTime now) {
        jdbc.update("""
                INSERT INTO coaching_handoffs (
                    id,
                    coach_session_id,
                    practice_session_id,
                    branch_kind,
                    handoff_json
                )
                VALUES (?, ?, ?, ?, ?::jsonb)
                """,
                handoffId,
                coachSessionId,
                practiceSessionId,
                branchKind,
                handoffJson.toString());
        if (confirmed) {
            jdbc.update("""
                    INSERT INTO handoff_confirmations (
                        coaching_handoff_id,
                        confirmed,
                        rebuttal_text,
                        created_at,
                        updated_at
                    )
                    VALUES (?, TRUE, NULL, ?, ?)
                    """, handoffId, now, now);
        }
    }

    public void addPracticeReportIfPresent(
            UUID practiceSessionId,
            UUID handoffId,
            JsonNode reportJson,
            OffsetDateTime now) {
        if (reportJson == null || "blocked".equals(reportJson.path("report_type").asText())) {
            return;
        }
        jdbc.update("""
                INSERT INTO practice_reports (
                    id,
                    practice_session_id,
                    report_type,
                    report_json,
                    source_handoff_id,
                    created_at
                )
                VALUES (?, ?, ?, ?::jsonb, ?, ?)
                """,
                UUID.randomUUID(),
                practiceSessionId,
                reportJson.path("report_type").asText(),
                reportJson.toString(),
                handoffId,
                now);
    }

    public void finishExternalOperation(
            UUID operationId,
            UUID leaseToken,
            JsonNode responsePayload,
            OffsetDateTime now) {
        int finished = jdbc.update("""
                UPDATE external_operations
                SET status = 'succeeded'::operation_status_t,
                    response_payload = ?::jsonb,
                    error_code = NULL,
                    lease_token = NULL,
                    lease_expires_at = NULL,
                    updated_at = ?
                WHERE id = ?
                  AND status = 'running'::operation_status_t
                  AND lease_token = ?
                """,
                responsePayload.toString(),
                now,
                operationId,
                leaseToken);
        if (finished == 0) {
            throw new LeaseOwnershipException("external operation lease is not owned");
        }
    }

    private SessionRow mapSessionRow(ResultSet row, int rowNumber) throws SQLException {
        return new SessionRow(
                row.getObject("summary_id", UUID.class),
                row.getString("coach_status"),
                row.getString("close_reason"),
                row.getString("conversation_summary"),
                parseJson(row.getString("observations_json")),
                parseJson(row.getString("uncertainties_json")),
                row.getObject("practice_session_id", UUID.class),
                row.getObject("user_id", UUID.class),
                row.getString("situation"),
                row.getString("character_context"),
                row.getString("goal"),
                row.getString("blockage_kind"),
                row.getString("sub_branch"),
                row.getString("blockage_detail"),
                row.getObject("upload_intent_id", UUID.class),
                row.getObject("duration_ms", Integer.class));
    }

    private HandoffRow mapHandoff(ResultSet row, int rowNumber) throws SQLException {
        return new HandoffRow(
                row.getObject("id", UUID.class),
                row.getString("branch_kind"),
                parseJson(row.getString("handoff_json")),
                row.getObject("confirmed", Boolean.class));
    }

    private JsonNode findConfirmedAnalysisHandoff(UUID userId, UUID uploadIntentId) {
        List<String> values = jdbc.queryForList("""
                SELECT h.handoff_json::text
                FROM coaching_handoffs h
                JOIN handoff_confirmations c ON c.coaching_handoff_id = h.id
                JOIN practice_sessions ps ON ps.id = h.practice_session_id
                WHERE ps.user_id = ?
                  AND ps.upload_intent_id = ?
                  AND h.branch_kind = 'analysis'
                  AND c.confirmed IS TRUE
                ORDER BY h.created_at DESC, h.id DESC
                LIMIT 1
                """, String.class, userId, uploadIntentId);
        return values.isEmpty() ? null : parseJson(values.getFirst());
    }

    private JsonNode observationPack(SessionRow row) {
        if (row.summaryId() == null) {
            return null;
        }
        ObjectNode pack = objectMapper.createObjectNode();
        pack.set("observations", row.observations());
        pack.set("uncertainties", row.uncertainties());
        return pack;
    }

    private ObjectNode emptyObservationPack() {
        ObjectNode pack = objectMapper.createObjectNode();
        pack.set("observations", objectMapper.createArrayNode());
        pack.set("uncertainties", objectMapper.createArrayNode());
        return pack;
    }

    private JsonNode parseJson(String value) {
        if (value == null) {
            return null;
        }
        try {
            return objectMapper.readTree(value);
        } catch (JsonProcessingException exception) {
            throw new IllegalStateException("database JSON could not be parsed", exception);
        }
    }

    public record OperationRow(UUID practiceSessionId, String kind) {
    }

    private record SessionRow(
            UUID summaryId,
            String status,
            String closeReason,
            String conversationSummary,
            JsonNode observations,
            JsonNode uncertainties,
            UUID practiceSessionId,
            UUID userId,
            String situation,
            String characterContext,
            String goal,
            String blockageKind,
            String subBranch,
            String blockageDetail,
            UUID uploadIntentId,
            Integer durationMs) {
    }

    private record PracticeContextRow(
            UUID practiceSessionId,
            UUID userId,
            String situation,
            String characterContext,
            String goal,
            String blockageKind,
            String subBranch,
            String blockageDetail,
            UUID uploadIntentId,
            Integer durationMs,
            UUID summaryId,
            JsonNode observations,
            JsonNode uncertainties) {
    }

    private record HandoffRow(
            UUID id,
            String branchKind,
            JsonNode json,
            Boolean confirmed) {
    }
}
