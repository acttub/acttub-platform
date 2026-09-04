package com.acttub.actingapi.feature.coach.adapter.db;

import static com.acttub.actingapi.platform.persistence.NativeTuples.list;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

import com.acttub.actingapi.feature.coach.app.CoachSessionSnapshot;
import com.acttub.actingapi.feature.coach.app.LookupError;
import com.acttub.actingapi.feature.coach.app.OwnedPracticeSessionContext;
import com.acttub.actingapi.feature.coach.app.SessionWriteConflict;
import com.acttub.actingapi.feature.coach.domain.CoachBranch;
import com.acttub.actingapi.feature.coach.domain.CoachTurnSnapshot;
import com.acttub.actingapi.feature.report.app.OwnedReportSource;
import com.acttub.actingapi.feature.coach.schema.CoachSessionEntity;
import com.acttub.actingapi.feature.coach.schema.CoachTurnEntity;
import com.acttub.actingapi.feature.coach.schema.CoachingHandoffEntity;
import com.acttub.actingapi.platform.ledger.LeaseOwnershipException;
import com.acttub.actingapi.platform.schema.SessionStatus;
import com.acttub.actingapi.platform.schema.TurnRole;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Tuple;
import org.springframework.stereotype.Component;

/**
 * Coach-session 저장 연산의 트랜잭션 내부 작업.
 *
 * <p>이 클래스에는 의도적으로 {@code @Transactional}이 없다. 모든 메서드는
 * {@link PostgresCoachSessionRepository}가 연 트랜잭션에 참여한다 — <b>어느 쿼리들이 한
 * 트랜잭션인지가 그 한 파일에 모여 보이게</b> 하려고 경계를 이쪽에 두지 않는다.
 */
@Component
public class CoachSessionWork {

    private final EntityManager entityManager;
    private final CoachSessionJpaRepository coachSessions;
    private final ObjectMapper objectMapper;

    public CoachSessionWork(
            EntityManager entityManager,
            CoachSessionJpaRepository coachSessions,
            ObjectMapper objectMapper) {
        this.entityManager = entityManager;
        this.coachSessions = coachSessions;
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
                    cs.status AS coach_status,
                    cs.close_reason,
                    cs.conversation_summary,
                    s.raw::text AS observations_json,
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
                WHERE cs.id = :sessionId
                """);
        if (userId != null) {
            sql.append(" AND ps.user_id = :userId\n");
        }
        if (!includeHidden) {
            sql.append(" AND ps.hidden_at IS NULL\n");
        }
        sql.append(" FOR SHARE OF cs");

        var query = entityManager.createNativeQuery(sql.toString(), Tuple.class)
                .setParameter("sessionId", sessionId);
        if (userId != null) {
            query.setParameter("userId", userId);
        }
        List<Tuple> rows = list(query);
        if (rows.isEmpty()) {
            return null;
        }

        SessionRow row = mapSessionRow(rows.getFirst());
        List<CoachTurnSnapshot> turns = coachTurns(sessionId);
        List<String> transcripts = transcripts(row.practiceSessionId());
        JsonNode analysisHandoff = CoachBranch.isExpressionBlockage(row.blockageKind())
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
        List<Tuple> statuses = list(entityManager.createNativeQuery("""
                SELECT status AS status
                FROM coach_sessions
                WHERE id = :sessionId
                FOR UPDATE
                """, Tuple.class)
                .setParameter("sessionId", session.sessionId()));
        if (statuses.isEmpty()) {
            throw new LookupError("session not found");
        }

        List<CoachTurnSnapshot> storedTurns = coachTurns(session.sessionId());
        if (session.turns().size() < storedTurns.size()) {
            throw new SessionWriteConflict("session turns are stale");
        }
        for (int index = 0; index < storedTurns.size(); index++) {
            if (!storedTurns.get(index).equals(session.turns().get(index))) {
                throw new SessionWriteConflict("session turns changed concurrently");
            }
        }
        if ("closed".equals(statuses.getFirst().get("status", String.class))
                && (!"closed".equals(session.status())
                        || session.turns().size() > storedTurns.size())) {
            throw new SessionWriteConflict("closed session changed concurrently");
        }

        for (int index = storedTurns.size(); index < session.turns().size(); index++) {
            CoachTurnSnapshot turn = session.turns().get(index);
            entityManager.persist(new CoachTurnEntity(
                    session.sessionId(),
                    index,
                    turnRole(turn.role()),
                    turn.text()));
        }
        // turn INSERT가 session 상태 갱신보다 늦춰지지 않도록 현재 SQL 순서를 고정한다.
        entityManager.flush();
        coachSessions.updateState(
                session.sessionId(),
                sessionStatus(session.status()),
                session.conversationSummary(),
                now.toInstant());
    }

    public UUID findOldestOpenCoachSessionId(UUID userId, UUID practiceSessionId) {
        List<Tuple> ids = list(entityManager.createNativeQuery("""
                SELECT cs.id AS id
                FROM coach_sessions cs
                JOIN practice_sessions ps ON ps.id = cs.practice_session_id
                WHERE cs.practice_session_id = :practiceSessionId
                  AND cs.status = 'open'
                  AND ps.user_id = :userId
                  AND ps.hidden_at IS NULL
                ORDER BY cs.created_at, cs.id
                LIMIT 1
                """, Tuple.class)
                .setParameter("practiceSessionId", practiceSessionId)
                .setParameter("userId", userId));
        return ids.isEmpty() ? null : ids.getFirst().get("id", UUID.class);
    }

    public String practiceSessionStatus(UUID userId, UUID practiceSessionId) {
        List<Tuple> values = list(entityManager.createNativeQuery("""
                SELECT status AS status
                FROM practice_sessions
                WHERE id = :practiceSessionId
                  AND user_id = :userId
                  AND hidden_at IS NULL
                """, Tuple.class)
                .setParameter("practiceSessionId", practiceSessionId)
                .setParameter("userId", userId));
        return values.isEmpty() ? null : values.getFirst().get("status", String.class);
    }

    public OwnedPracticeSessionContext ownedPracticeSessionContext(
            UUID userId, UUID practiceSessionId) {
        List<Tuple> rows = list(entityManager.createNativeQuery("""
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
                    s.raw::text AS observations_json,
                    s.uncertainties_json::text AS uncertainties_json
                FROM practice_sessions ps
                JOIN upload_intents ui ON ui.id = ps.upload_intent_id
                LEFT JOIN summaries s ON s.session_id = ps.id
                WHERE ps.id = :practiceSessionId
                  AND ps.user_id = :userId
                  AND ps.hidden_at IS NULL
                """, Tuple.class)
                .setParameter("practiceSessionId", practiceSessionId)
                .setParameter("userId", userId));
        if (rows.isEmpty()) {
            return null;
        }
        PracticeContextRow row = mapPracticeContextRow(rows.getFirst());
        ObjectNode pack = null;
        if (row.summaryId() != null) {
            pack = objectMapper.createObjectNode();
            pack.set("observations", row.observations());
            pack.set("uncertainties", row.uncertainties());
        }
        List<String> transcripts = transcripts(practiceSessionId);
        JsonNode analysisHandoff = CoachBranch.isExpressionBlockage(row.blockageKind())
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
        List<Tuple> values = list(entityManager.createNativeQuery("""
                SELECT EXISTS (
                    SELECT 1 FROM practice_reports
                    WHERE practice_session_id = :practiceSessionId
                ) AS present
                """, Tuple.class)
                .setParameter("practiceSessionId", practiceSessionId));
        return !values.isEmpty() && Boolean.TRUE.equals(
                values.getFirst().get("present", Boolean.class));
    }

    public JsonNode practiceReportForHandoff(UUID handoffId) {
        List<Tuple> values = list(entityManager.createNativeQuery("""
                SELECT report_json::text AS report_json
                FROM practice_reports
                WHERE source_handoff_id = :handoffId
                """, Tuple.class)
                .setParameter("handoffId", handoffId));
        return values.isEmpty()
                ? null
                : parseJson(values.getFirst().get("report_json", String.class));
    }

    public void addCoachSession(CoachSessionSnapshot session) {
        entityManager.persist(new CoachSessionEntity(
                session.sessionId(),
                session.practiceSessionId(),
                session.summaryId(),
                sessionStatus(session.status()),
                session.conversationSummary()));
        for (int index = 0; index < session.turns().size(); index++) {
            CoachTurnSnapshot turn = session.turns().get(index);
            entityManager.persist(new CoachTurnEntity(
                    session.sessionId(),
                    index,
                    turnRole(turn.role()),
                    turn.text()));
        }
        // 뒤의 handoff/report native SQL보다 session·turn INSERT를 먼저 실행한다.
        entityManager.flush();
    }

    public int closeOpenCoachSessions(UUID practiceSessionId, OffsetDateTime now) {
        return coachSessions.closeOpenByPracticeSessionId(
                practiceSessionId,
                SessionStatus.OPEN,
                SessionStatus.CLOSED,
                now.toInstant());
    }

    public OwnedReportSource ownedReportSource(UUID userId, UUID coachSessionId) {
        CoachSessionSnapshot session = loadSession(coachSessionId, userId, false);
        if (session == null) {
            return null;
        }

        List<Tuple> latest = list(entityManager.createNativeQuery("""
                SELECT
                    h.id,
                    h.branch_kind,
                    h.handoff_json::text AS handoff_json,
                    c.confirmed
                FROM coaching_handoffs h
                LEFT JOIN handoff_confirmations c ON c.coaching_handoff_id = h.id
                WHERE h.coach_session_id = :coachSessionId
                ORDER BY h.created_at DESC, h.id DESC
                LIMIT 1
                """, Tuple.class)
                .setParameter("coachSessionId", coachSessionId));
        HandoffRow handoff = latest.isEmpty() ? null : mapHandoff(latest.getFirst());
        String branchKind = handoff == null
                ? CoachBranch.of(session.blockageKind())
                : handoff.branchKind();

        HandoffRow analysis = null;
        if (CoachBranch.EXPRESSION.equals(branchKind)) {
            List<Tuple> rows = list(entityManager.createNativeQuery("""
                    SELECT
                        h.id,
                        h.branch_kind,
                        h.handoff_json::text AS handoff_json,
                        c.confirmed
                    FROM coaching_handoffs h
                    JOIN handoff_confirmations c ON c.coaching_handoff_id = h.id
                    WHERE h.practice_session_id = :practiceSessionId
                      AND h.branch_kind = 'analysis'
                      AND c.confirmed IS TRUE
                    ORDER BY h.created_at DESC, h.id DESC
                    LIMIT 1
                    """, Tuple.class)
                    .setParameter("practiceSessionId", session.practiceSessionId()));
            analysis = rows.isEmpty() ? null : mapHandoff(rows.getFirst());
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
        entityManager.createNativeQuery("""
                INSERT INTO handoff_confirmations (
                    coaching_handoff_id,
                    confirmed,
                    rebuttal_text,
                    updated_at
                )
                VALUES (:handoffId, :confirmed, :rebuttalText, :now)
                ON CONFLICT (coaching_handoff_id) DO UPDATE
                SET confirmed = EXCLUDED.confirmed,
                    rebuttal_text = EXCLUDED.rebuttal_text,
                    updated_at = EXCLUDED.updated_at
                """)
                .setParameter("handoffId", handoffId)
                .setParameter("confirmed", confirmed)
                .setParameter("rebuttalText", rebuttalText)
                .setParameter("now", now)
                .executeUpdate();
    }

    public void closeCoachSession(UUID coachSessionId, OffsetDateTime now) {
        coachSessions.updateStatus(
                coachSessionId, SessionStatus.CLOSED, now.toInstant());
    }

    public OperationRow requireCoachStartOperation(UUID operationId) {
        return requireOperation(operationId, "coach_start", "coach start");
    }

    public OperationRow requireCoachReplyOperation(UUID operationId) {
        return requireOperation(operationId, "coach_reply", "coach reply");
    }

    private OperationRow requireOperation(
            UUID operationId, String expectedKind, String label) {
        List<Tuple> rows = list(entityManager.createNativeQuery("""
                SELECT session_id AS session_id, kind AS kind
                FROM external_operations
                WHERE id = :operationId
                """, Tuple.class)
                .setParameter("operationId", operationId));
        if (rows.isEmpty()) {
            throw new LookupError("external operation not found");
        }
        Tuple row = rows.getFirst();
        OperationRow operation = new OperationRow(
                row.get("session_id", UUID.class),
                row.get("kind", String.class));
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
        entityManager.persist(new CoachingHandoffEntity(
                handoffId,
                coachSessionId,
                practiceSessionId,
                branchKind,
                handoffJson));
        // confirmation/report의 FK가 handoff INSERT보다 먼저 실행되지 않게 한다.
        entityManager.flush();
        if (confirmed) {
            entityManager.createNativeQuery("""
                    INSERT INTO handoff_confirmations (
                        coaching_handoff_id,
                        confirmed,
                        rebuttal_text,
                        created_at,
                        updated_at
                    )
                    VALUES (:handoffId, TRUE, NULL, :now, :now)
                    """)
                    .setParameter("handoffId", handoffId)
                    .setParameter("now", now)
                    .executeUpdate();
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
        entityManager.createNativeQuery("""
                INSERT INTO practice_reports (
                    id,
                    practice_session_id,
                    report_type,
                    report_json,
                    source_handoff_id,
                    created_at
                )
                VALUES (
                    :id,
                    :practiceSessionId,
                    :reportType,
                    CAST(:reportJson AS jsonb),
                    :handoffId,
                    :now
                )
                """)
                .setParameter("id", UUID.randomUUID())
                .setParameter("practiceSessionId", practiceSessionId)
                .setParameter("reportType", reportJson.path("report_type").asText())
                .setParameter("reportJson", reportJson.toString())
                .setParameter("handoffId", handoffId)
                .setParameter("now", now)
                .executeUpdate();
    }

    public void finishExternalOperation(
            UUID operationId,
            UUID leaseToken,
            JsonNode responsePayload,
            OffsetDateTime now) {
        int finished = entityManager.createNativeQuery("""
                UPDATE external_operations
                SET status = 'succeeded',
                    response_payload = CAST(:responsePayload AS jsonb),
                    error_code = NULL,
                    lease_token = NULL,
                    lease_expires_at = NULL,
                    updated_at = :now
                WHERE id = :operationId
                  AND status = 'running'
                  AND lease_token = :leaseToken
                """)
                .setParameter("responsePayload", responsePayload.toString())
                .setParameter("now", now)
                .setParameter("operationId", operationId)
                .setParameter("leaseToken", leaseToken)
                .executeUpdate();
        if (finished == 0) {
            throw new LeaseOwnershipException("external operation lease is not owned");
        }
    }

    private SessionRow mapSessionRow(Tuple row) {
        return new SessionRow(
                row.get("summary_id", UUID.class),
                row.get("coach_status", String.class),
                row.get("close_reason", String.class),
                row.get("conversation_summary", String.class),
                parseJson(row.get("observations_json", String.class)),
                parseJson(row.get("uncertainties_json", String.class)),
                row.get("practice_session_id", UUID.class),
                row.get("user_id", UUID.class),
                row.get("situation", String.class),
                row.get("character_context", String.class),
                row.get("goal", String.class),
                row.get("blockage_kind", String.class),
                row.get("sub_branch", String.class),
                row.get("blockage_detail", String.class),
                row.get("upload_intent_id", UUID.class),
                row.get("duration_ms", Integer.class));
    }

    private PracticeContextRow mapPracticeContextRow(Tuple row) {
        return new PracticeContextRow(
                row.get("practice_session_id", UUID.class),
                row.get("user_id", UUID.class),
                row.get("situation", String.class),
                row.get("character_context", String.class),
                row.get("goal", String.class),
                row.get("blockage_kind", String.class),
                row.get("sub_branch", String.class),
                row.get("blockage_detail", String.class),
                row.get("upload_intent_id", UUID.class),
                row.get("duration_ms", Integer.class),
                row.get("summary_id", UUID.class),
                parseJson(row.get("observations_json", String.class)),
                parseJson(row.get("uncertainties_json", String.class)));
    }

    private HandoffRow mapHandoff(Tuple row) {
        return new HandoffRow(
                row.get("id", UUID.class),
                row.get("branch_kind", String.class),
                parseJson(row.get("handoff_json", String.class)),
                row.get("confirmed", Boolean.class));
    }

    private JsonNode findConfirmedAnalysisHandoff(UUID userId, UUID uploadIntentId) {
        List<Tuple> values = list(entityManager.createNativeQuery("""
                SELECT h.handoff_json::text AS handoff_json
                FROM coaching_handoffs h
                JOIN handoff_confirmations c ON c.coaching_handoff_id = h.id
                JOIN practice_sessions ps ON ps.id = h.practice_session_id
                WHERE ps.user_id = :userId
                  AND ps.upload_intent_id = :uploadIntentId
                  AND h.branch_kind = 'analysis'
                  AND c.confirmed IS TRUE
                ORDER BY h.created_at DESC, h.id DESC
                LIMIT 1
                """, Tuple.class)
                .setParameter("userId", userId)
                .setParameter("uploadIntentId", uploadIntentId));
        return values.isEmpty()
                ? null
                : parseJson(values.getFirst().get("handoff_json", String.class));
    }

    private List<CoachTurnSnapshot> coachTurns(UUID sessionId) {
        return list(entityManager.createQuery("""
                SELECT turn.role AS role, turn.text AS text
                FROM CoachTurnEntity turn
                WHERE turn.sessionId = :sessionId
                ORDER BY turn.turnIndex
                """, Tuple.class)
                .setParameter("sessionId", sessionId)).stream()
                .map(row -> new CoachTurnSnapshot(
                        row.get("role", TurnRole.class).dbValue(),
                        row.get("text", String.class)))
                .toList();
    }

    private List<String> transcripts(UUID practiceSessionId) {
        return list(entityManager.createNativeQuery("""
                SELECT text AS text
                FROM transcripts
                WHERE session_id = :practiceSessionId
                ORDER BY ord
                """, Tuple.class)
                .setParameter("practiceSessionId", practiceSessionId)).stream()
                .map(row -> row.get("text", String.class))
                .toList();
    }

    private SessionStatus sessionStatus(String value) {
        return SessionStatus.valueOf(value.toUpperCase(Locale.ROOT));
    }

    private TurnRole turnRole(String value) {
        return TurnRole.valueOf(value.toUpperCase(Locale.ROOT));
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
