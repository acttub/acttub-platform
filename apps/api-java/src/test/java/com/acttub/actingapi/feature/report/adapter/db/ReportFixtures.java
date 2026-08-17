package com.acttub.actingapi.feature.report.adapter.db;

import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.UUID;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import org.springframework.jdbc.core.JdbcTemplate;

/** {@code complete_practice_report_operation}에 필요한 최소 FK 체인. */
public final class ReportFixtures {

    static final Instant NOW = Instant.parse("2026-08-08T02:03:04.567890Z");

    private final JdbcTemplate jdbc;

    public ReportFixtures(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    record Scenario(
            UUID userId,
            UUID practiceSessionId,
            UUID sourceHandoffId,
            UUID operationId,
            UUID leaseToken) {
    }

    Scenario create() {
        UUID userId = insertUser();
        UUID practiceSessionId = insertPracticeSession(userId);
        UUID sourceHandoffId = insertHandoff(practiceSessionId);
        UUID leaseToken = UUID.randomUUID();
        UUID operationId = insertRunningReportOperation(
                practiceSessionId, userId, leaseToken, NOW.plusSeconds(300));
        return new Scenario(
                userId,
                practiceSessionId,
                sourceHandoffId,
                operationId,
                leaseToken);
    }

    UUID insertUser() {
        UUID id = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO users (id, email, status)
                VALUES (?, ?, 'active'::user_status_t)
                """, id, id + "@example.test");
        return id;
    }

    UUID insertPracticeSession(UUID userId) {
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
                    expires_at
                )
                VALUES (?, ?, 'finalized'::upload_status_t, 's3', ?, 'video/mp4', 1, ?)
                """,
                uploadId,
                userId,
                "uploads/" + uploadId + ".mp4",
                NOW.plusSeconds(3600).atOffset(ZoneOffset.UTC));

        UUID sessionId = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO practice_sessions (
                    id,
                    user_id,
                    upload_intent_id,
                    status,
                    situation,
                    character_context,
                    blockage_kind,
                    sub_branch,
                    goal
                )
                VALUES (
                    ?,
                    ?,
                    ?,
                    'analyzed'::practice_status_t,
                    '상황',
                    '인물',
                    '분석',
                    '캐릭터 분석',
                    '목표'
                )
                """, sessionId, userId, uploadId);
        return sessionId;
    }

    public UUID insertHandoff(UUID practiceSessionId) {
        UUID coachSessionId = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO coach_sessions (
                    id,
                    practice_session_id,
                    status,
                    conversation_summary
                )
                VALUES (?, ?, 'closed'::session_status_t, '')
                """, coachSessionId, practiceSessionId);

        return insertHandoff(practiceSessionId, coachSessionId);
    }

    public UUID insertHandoff(UUID practiceSessionId, UUID coachSessionId) {
        UUID handoffId = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO coaching_handoffs (
                    id,
                    coach_session_id,
                    practice_session_id,
                    branch_kind,
                    handoff_json
                )
                VALUES (?, ?, ?, 'analysis', '{}'::jsonb)
                """, handoffId, coachSessionId, practiceSessionId);
        return handoffId;
    }

    UUID insertRunningReportOperation(
            UUID practiceSessionId,
            UUID userId,
            UUID leaseToken,
            Instant leaseExpiresAt) {
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
                    'report'::operation_kind_t,
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
                leaseExpiresAt.atOffset(ZoneOffset.UTC));
        return operationId;
    }

    UUID insertPracticeReport(Scenario scenario) {
        UUID reportId = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO practice_reports (
                    id,
                    practice_session_id,
                    report_type,
                    report_json,
                    source_handoff_id,
                    created_at
                )
                VALUES (?, ?, 'analysis', ?::jsonb, ?, ?)
                """,
                reportId,
                scenario.practiceSessionId(),
                reportJson().toString(),
                scenario.sourceHandoffId(),
                NOW.atOffset(ZoneOffset.UTC));
        return reportId;
    }

    static JsonNode reportJson() {
        return JsonNodeFactory.instance.objectNode()
                .put("headline", "분석 리포트")
                .put("next_step", "호흡을 한 박자 늦춘다");
    }

    static JsonNode responsePayload() {
        return JsonNodeFactory.instance.objectNode()
                .put("status", "reported")
                .put("report_type", "analysis");
    }
}
