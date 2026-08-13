package com.acttub.actingapi.coach;

import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import org.springframework.jdbc.core.JdbcTemplate;

final class CoachStorageFixtures {

    static final Instant NOW = Instant.parse("2026-08-08T04:05:06.123456Z");

    private final JdbcTemplate jdbc;

    CoachStorageFixtures(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    UUID insertUser() {
        UUID userId = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO users (id, email, status)
                VALUES (?, ?, 'active'::user_status_t)
                """, userId, userId + "@coach-storage.test");
        return userId;
    }

    Practice insertPractice(UUID userId) {
        return insertPractice(userId, false);
    }

    Practice insertPractice(UUID userId, boolean hidden) {
        UUID uploadId = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO upload_intents (
                    id,
                    user_id,
                    status,
                    storage_provider,
                    object_key,
                    mime_type,
                    size_bytes,
                    duration_ms,
                    expires_at
                )
                VALUES (
                    ?,
                    ?,
                    'finalized'::upload_status_t,
                    's3',
                    ?,
                    'video/mp4',
                    1,
                    3210,
                    ?
                )
                """,
                uploadId,
                userId,
                "uploads/" + uploadId + ".mp4",
                NOW.plusSeconds(3600).atOffset(ZoneOffset.UTC));

        UUID practiceSessionId = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO practice_sessions (
                    id,
                    user_id,
                    upload_intent_id,
                    status,
                    situation,
                    character_context,
                    goal,
                    blockage_kind,
                    sub_branch,
                    blockage_detail,
                    hidden_at
                )
                VALUES (
                    ?,
                    ?,
                    ?,
                    'analyzed'::practice_status_t,
                    '오디션 직전',
                    '불안한 배우',
                    '상대를 붙잡는다',
                    '분석',
                    '대사 분석',
                    '대사의 목적이 흐리다',
                    ?
                )
                """,
                practiceSessionId,
                userId,
                uploadId,
                hidden ? NOW.atOffset(ZoneOffset.UTC) : null);
        return new Practice(practiceSessionId, uploadId, userId);
    }

    UUID insertSummary(UUID practiceSessionId) {
        UUID summaryId = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO summaries (
                    id,
                    session_id,
                    model,
                    was_compressed,
                    raw,
                    observations_json,
                    uncertainties_json
                )
                VALUES (?, ?, 'test-model', FALSE, '{}'::jsonb, ?::jsonb, ?::jsonb)
                """,
                summaryId,
                practiceSessionId,
                "[{\"evidence\":\"시선\"}]",
                "[{\"question\":\"호흡\"}]");
        return summaryId;
    }

    void insertTranscript(UUID practiceSessionId, int order, String text) {
        jdbc.update("""
                INSERT INTO transcripts (id, session_id, ord, text)
                VALUES (?, ?, ?, ?)
                """, UUID.randomUUID(), practiceSessionId, order, text);
    }

    void insertCoachSession(
            UUID sessionId,
            UUID practiceSessionId,
            UUID summaryId,
            String status,
            OffsetDateTime createdAt,
            List<CoachTurnSnapshot> turns) {
        jdbc.update("""
                INSERT INTO coach_sessions (
                    id,
                    practice_session_id,
                    summary_id,
                    status,
                    conversation_summary,
                    created_at,
                    updated_at
                )
                VALUES (?, ?, ?, ?::session_status_t, '', ?, ?)
                """,
                sessionId,
                practiceSessionId,
                summaryId,
                status,
                createdAt,
                createdAt);
        for (int index = 0; index < turns.size(); index++) {
            CoachTurnSnapshot turn = turns.get(index);
            jdbc.update("""
                    INSERT INTO coach_turns (session_id, turn_index, role, text)
                    VALUES (?, ?, ?::turn_role_t, ?)
                    """, sessionId, index, turn.role(), turn.text());
        }
    }

    UUID insertRunningCoachStartOperation(UUID userId, UUID practiceSessionId, UUID leaseToken) {
        UUID operationId = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO external_operations (
                    id,
                    session_id,
                    user_id,
                    request_id,
                    kind,
                    status,
                    attempt_count,
                    request_fingerprint,
                    lease_token,
                    lease_expires_at
                )
                VALUES (
                    ?,
                    ?,
                    ?,
                    ?,
                    'coach_start'::operation_kind_t,
                    'running'::operation_status_t,
                    1,
                    ?,
                    ?,
                    ?
                )
                """,
                operationId,
                practiceSessionId,
                userId,
                UUID.randomUUID(),
                "0".repeat(64),
                leaseToken,
                NOW.plusSeconds(300).atOffset(ZoneOffset.UTC));
        return operationId;
    }

    UUID insertHandoff(
            UUID coachSessionId,
            UUID practiceSessionId,
            OffsetDateTime createdAt) {
        UUID handoffId = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO coaching_handoffs (
                    id,
                    coach_session_id,
                    practice_session_id,
                    branch_kind,
                    handoff_json,
                    created_at
                )
                VALUES (?, ?, ?, 'analysis', ?::jsonb, ?)
                """,
                handoffId,
                coachSessionId,
                practiceSessionId,
                handoffJson().toString(),
                createdAt);
        return handoffId;
    }

    CoachSessionSnapshot newSnapshot(
            UUID sessionId,
            Practice practice,
            UUID summaryId,
            List<CoachTurnSnapshot> turns) {
        return new CoachSessionSnapshot(
                sessionId,
                practice.id(),
                summaryId,
                practice.userId(),
                JsonNodeFactory.instance.objectNode()
                        .set("observations", JsonNodeFactory.instance.arrayNode()),
                "오디션 직전",
                "불안한 배우",
                "상대를 붙잡는다",
                3210,
                "분석",
                "대사 분석",
                "대사의 목적이 흐리다",
                List.of(),
                "",
                null,
                "open",
                "",
                turns);
    }

    String coachStatus(UUID sessionId) {
        return jdbc.queryForObject("""
                SELECT status::text
                FROM coach_sessions
                WHERE id = ?
                """, String.class, sessionId);
    }

    static JsonNode handoffJson() {
        return JsonNodeFactory.instance.objectNode()
                .put("handoff_type", "analysis")
                .put("coach_summary", "상대를 붙잡는 목적을 찾았다");
    }

    static JsonNode responsePayload(List<CoachTurnSnapshot> turns) {
        var root = JsonNodeFactory.instance.objectNode()
                .put("status", "continue");
        var turnArray = root.putArray("turns");
        for (CoachTurnSnapshot turn : turns) {
            turnArray.addObject().put("role", turn.role()).put("text", turn.text());
        }
        return root;
    }

    record Practice(UUID id, UUID uploadId, UUID userId) {
    }
}
