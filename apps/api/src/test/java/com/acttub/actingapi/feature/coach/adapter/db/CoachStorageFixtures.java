package com.acttub.actingapi.feature.coach.adapter.db;

import com.acttub.actingapi.feature.coach.app.CoachSessionSnapshot;
import com.acttub.actingapi.feature.coach.domain.CoachTurnSnapshot;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import org.springframework.jdbc.core.JdbcTemplate;

public final class CoachStorageFixtures {

    public static final Instant NOW = Instant.parse("2026-08-08T04:05:06.123456Z");

    private final JdbcTemplate jdbc;

    public CoachStorageFixtures(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public UUID insertUser() {
        UUID userId = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO users (id, email, status)
                VALUES (?, ?, 'active')
                """, userId, userId + "@coach-storage.test");
        return userId;
    }

    public Practice insertPractice(UUID userId) {
        return insertPractice(userId, false);
    }

    public Practice insertPractice(UUID userId, boolean hidden) {
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
                    'finalized',
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
                    'analyzed',
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

    private static final String OBSERVATIONS =
            "[{\"start_ms\":0,\"end_ms\":3210,\"what\":\"멈춘 뒤 말한다\","
                    + "\"quote\":\"첫 대사\",\"dimension\":\"호흡\",\"confidence\":0.9}]";

    private static final String OBSERVATION_PACK =
            "{\"scene_summary\":\"여자가 문 앞에서 돌아선 상대를 붙잡는다.\",\"observations\":"
                    + OBSERVATIONS + ",\"uncertainties\":[\"얼굴은 확인되지 않음\"]}";

    public UUID insertSummary(UUID practiceSessionId) {
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
                VALUES (?, ?, 'test-model', FALSE, ?::jsonb, ?::jsonb, ?::jsonb)
                """,
                summaryId,
                practiceSessionId,
                // 코치가 읽는 것은 raw 다(SOMA-490) — 관찰을 걸러 다시 적은 칸이 아니라
                // 영상을 본 모델이 낸 그대로여야 코치가 장면을 안다.
                OBSERVATION_PACK,
                OBSERVATIONS,
                "[\"얼굴은 확인되지 않음\"]");
        return summaryId;
    }

    public void insertTranscript(UUID practiceSessionId, int order, String text) {
        jdbc.update("""
                INSERT INTO transcripts (id, session_id, ord, text)
                VALUES (?, ?, ?, ?)
                """, UUID.randomUUID(), practiceSessionId, order, text);
    }

    public void insertCoachSession(
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
                VALUES (?, ?, ?, ?, '', ?, ?)
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
                    VALUES (?, ?, ?, ?)
                    """, sessionId, index, turn.role(), turn.text());
        }
    }

    public UUID insertRunningCoachStartOperation(UUID userId, UUID practiceSessionId, UUID leaseToken) {
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
                    'coach_start',
                    'running',
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

    public UUID insertHandoff(
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

    public CoachSessionSnapshot newSnapshot(
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

    public String coachStatus(UUID sessionId) {
        return jdbc.queryForObject("""
                SELECT status
                FROM coach_sessions
                WHERE id = ?
                """, String.class, sessionId);
    }

    public static JsonNode handoffJson() {
        return JsonNodeFactory.instance.objectNode()
                .put("handoff_type", "analysis")
                .put("coach_summary", "상대를 붙잡는 목적을 찾았다");
    }

    public static JsonNode responsePayload(List<CoachTurnSnapshot> turns) {
        var root = JsonNodeFactory.instance.objectNode()
                .put("status", "continue");
        var turnArray = root.putArray("turns");
        for (CoachTurnSnapshot turn : turns) {
            turnArray.addObject().put("role", turn.role()).put("text", turn.text());
        }
        return root;
    }

    public record Practice(UUID id, UUID uploadId, UUID userId) {
    }
}
