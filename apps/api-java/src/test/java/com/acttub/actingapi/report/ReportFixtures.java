package com.acttub.actingapi.report;

import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.UUID;

import org.springframework.jdbc.core.JdbcTemplate;

/**
 * {@code complete_report_operation} 을 돌리는 데 필요한 최소 행들을 만든다.
 *
 * <p>체인은 {@code users → upload_intents → practice_sessions → summaries → coach_sessions}
 * 이고, 여기에 {@code external_operations}(kind=report, status=running, lease_token 보유)가 붙는다.
 */
final class ReportFixtures {

    private final JdbcTemplate jdbc;

    ReportFixtures(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    record Scenario(UUID userId, UUID practiceSessionId, UUID summaryId, UUID coachSessionId,
            UUID operationId, UUID leaseToken) {
    }

    /**
     * {@code ck_practice_sessions_blockage_branch} 가 허용하는 조합 중 하나.
     * ({@code 분석}, {@code 캐릭터 분석}) 이외의 짝을 넣으면 INSERT 가 거부된다.
     */
    static final String BLOCKAGE_KIND = "분석";
    static final String SUB_BRANCH = "캐릭터 분석";

    Scenario create() {
        UUID userId = insertUser();
        UUID practiceSessionId = insertPracticeSession(userId);
        UUID summaryId = insertSummary(practiceSessionId);
        UUID coachSessionId = insertCoachSession(summaryId, practiceSessionId);
        UUID leaseToken = UUID.randomUUID();
        UUID operationId = insertRunningReportOperation(practiceSessionId, userId, leaseToken);
        return new Scenario(userId, practiceSessionId, summaryId, coachSessionId, operationId,
                leaseToken);
    }

    UUID insertUser() {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO users (id, email, status) VALUES (?, ?, 'active'::user_status_t)",
                id, id + "@example.test");
        return id;
    }

    UUID insertPracticeSession(UUID userId) {
        UUID uploadIntentId = UUID.randomUUID();
        jdbc.update("INSERT INTO upload_intents "
                + "(id, user_id, status, storage_provider, object_key, mime_type, size_bytes, expires_at) "
                + "VALUES (?, ?, 'finalized'::upload_status_t, 's3', ?, 'video/mp4', 1024, ?)",
                uploadIntentId, userId, "uploads/" + uploadIntentId + ".mp4",
                OffsetDateTime.now(ZoneOffset.UTC).plusDays(1));

        UUID id = UUID.randomUUID();
        // blockage_kind·sub_branch·goal 은 alembic 0010 이 NOT NULL 로 추가했다.
        jdbc.update("INSERT INTO practice_sessions "
                + "(id, user_id, upload_intent_id, status, situation, character_context, subtext, "
                + "blockage_kind, sub_branch, goal) "
                + "VALUES (?, ?, ?, 'analyzed'::practice_status_t, ?, ?, ?, ?, ?, ?)",
                id, userId, uploadIntentId, "상황", "인물설정", "서브텍스트",
                BLOCKAGE_KIND, SUB_BRANCH, "목표");
        return id;
    }

    UUID insertSummary(UUID practiceSessionId) {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO summaries "
                + "(id, session_id, observation, summary, intent_alignment, key_moment, "
                + "key_dimension, model, was_compressed, raw) "
                + "VALUES (?, ?, ?::jsonb, ?, ?, ?, ?, ?, false, ?::jsonb)",
                id, practiceSessionId, "{}", "요약", "의도대비", "00:10", "템포",
                "gemini-2.5-flash", "{}");
        return id;
    }

    /** {@code practice_session_id} 는 alembic 0007 이 NOT NULL 로 추가했다. */
    UUID insertCoachSession(UUID summaryId, UUID practiceSessionId) {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO coach_sessions (id, summary_id, practice_session_id, status) "
                + "VALUES (?, ?, ?, 'closed'::session_status_t)", id, summaryId, practiceSessionId);
        return id;
    }

    UUID insertRunningReportOperation(UUID practiceSessionId, UUID userId, UUID leaseToken) {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO external_operations "
                + "(id, session_id, user_id, request_id, kind, status, attempt_count, "
                + "request_fingerprint, lease_token, lease_expires_at) "
                + "VALUES (?, ?, ?, ?, 'report'::operation_kind_t, 'running'::operation_status_t, "
                + "1, ?, ?, ?)",
                id, practiceSessionId, userId, UUID.randomUUID(), "0".repeat(64), leaseToken,
                OffsetDateTime.now(ZoneOffset.UTC).plusMinutes(5));
        return id;
    }

    /** practice session 하나에 summary + coach session 을 달고 coach session id 를 준다. */
    UUID insertCoachSessionFor(UUID practiceSessionId) {
        return insertCoachSession(insertSummary(practiceSessionId), practiceSessionId);
    }

    /** 리포트 행을 직접 넣는다 — 사전 확인 경로와 커밋 경쟁 경로를 만드는 데 쓴다. */
    void insertReportDirectly(UUID coachSessionId) {
        jdbc.update("INSERT INTO reports "
                + "(id, session_id, headline, biggest_problem, evidence, self_discovery, "
                + "encouragement, next_step, comparison) "
                + "VALUES (?, ?, '기존', '{}'::jsonb, 'e', 's', 'en', 'n', '')",
                UUID.randomUUID(), coachSessionId);
    }

    static ActingReportPayload samplePayload() {
        return new ActingReportPayload(
                "오늘 연기는 시선이 살아 있었다",
                new BiggestProblem("00:12", "00:20", "템포", "말이 급해지면서 사이가 사라진다"),
                "00:12~00:20 구간에서 발화 속도가 눈에 띄게 빨라진다",
                "배우가 스스로 '긴장하면 빨라진다'고 말했다",
                "표정 전환은 자연스러웠다",
                "다음엔 문장 사이에 1초를 의식적으로 둔다",
                "");
    }

    static Instant fixedNow() {
        return Instant.parse("2026-08-06T01:02:03.456789Z");
    }
}
