package com.acttub.actingapi.feature.analysis.adapter.db;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import com.acttub.actingapi.feature.analysis.app.AnalysisResult;
import com.acttub.actingapi.feature.analysis.app.AnalysisStore;
import com.acttub.actingapi.integration.observation.ObservationItem;
import com.acttub.actingapi.integration.observation.ObservationPack;
import com.acttub.actingapi.platform.ledger.LeaseOwnershipException;
import com.acttub.actingapi.support.PostgresContainerSupport;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/**
 * 분석 완료 전이를 <b>실제 Postgres 위에서</b> 본다 — {@code PostgresAnalysisStore.complete} 는
 * 한 트랜잭션 안에서 요약을 넣고, 대사를 순서대로 넣고, 연습 세션을 {@code analyzed} 로 옮기고,
 * 요약을 못 받은 코치 세션에 그것을 걸고, 원장을 {@code succeeded} 로 닫는다.
 *
 * <p><b>계약 하네스에서 옮겨 온 자리다</b>(SOMA-403 4단계). 하네스의 {@code run-worker-once}
 * 제어를 통해 {@code HarnessContractProfileIT} 가 이 경로를 밟고 있었고, 그것이 사라지면
 * <b>{@code PostgresAnalysisStore} 를 실 DB 로 밟는 테스트가 하나도 남지 않았다</b> —
 * {@code AnalysisWorkerTest} 는 가짜 저장소로 전이 이름만 세므로 SQL 이 틀려도 초록이다.
 *
 * <p>⚠ <b>여기서 보는 것은 하네스가 보던 것보다 하나 넓다.</b> 하네스는 응답 바이트와 네 테이블만
 * 봤고 <b>코치 세션 연결</b>은 보지 않았다 — 같은 트랜잭션의 SQL 이라 함께 두지 않으면 그 한 줄만
 * 검사 밖에 남는다.
 *
 * <p>{@code sweepExpiredUploads} 는 변경된 행의 object key를 실제로 반환하는지 함께 본다.
 * S3 삭제 자체는 저장소 바깥 책임이라 여기서 호출하지 않는다.
 */
@SpringBootTest(properties = "JWT_SECRET=test-secret")
class PostgresAnalysisStoreIT {

    private static final Instant NOW = Instant.parse("2026-08-17T04:05:06.789012Z");
    private static final String FINGERPRINT = "c".repeat(64);
    private static final String MODEL = "gemini-3-pro-preview";

    @DynamicPropertySource
    static void datasource(DynamicPropertyRegistry registry) {
        String database = PostgresContainerSupport.createDatabaseName("analysis_store_it");
        registry.add("spring.datasource.url", () -> PostgresContainerSupport.jdbcUrlFor(database));
        registry.add("spring.datasource.username", PostgresContainerSupport.POSTGRES::getUsername);
        registry.add("spring.datasource.password", PostgresContainerSupport.POSTGRES::getPassword);
    }

    @Autowired
    JdbcTemplate jdbc;

    @Autowired
    AnalysisStore store;

    @Autowired
    ObjectMapper mapper;

    @BeforeEach
    void clearDatabase() {
        jdbc.execute("TRUNCATE TABLE users RESTART IDENTITY CASCADE");
    }

    @Test
    void completeStoresSummaryAndFinishesTheOperationInOneTransaction()
            throws Exception {
        UUID userId = insertUser();
        UUID sessionId = insertSession(userId, insertFinalizedUpload(userId));
        UUID operationId = insertAnalyzeOperation(userId, sessionId);
        UUID leaseToken = UUID.randomUUID();
        assertThat(store.claimNext(leaseToken, Duration.ofMinutes(5), NOW.minusSeconds(5)))
                .isEqualTo(operationId);

        UUID summaryId = store.complete(operationId, leaseToken, result(), MODEL, NOW);

        Map<String, Object> summary = jdbc.queryForMap("""
                SELECT session_id, model, was_compressed,
                       observations_json::text AS observations,
                       uncertainties_json::text AS uncertainties,
                       raw::text AS raw
                FROM summaries WHERE id = ?
                """, summaryId);
        assertThat(summary.get("session_id")).isEqualTo(sessionId);
        assertThat(summary.get("model")).isEqualTo(MODEL);
        assertThat(summary.get("was_compressed")).isEqualTo(true);
        assertThat(mapper.readTree((String) summary.get("observations"))).isEqualTo(
                mapper.readTree("""
                        [{"start_ms":0,"end_ms":1200,"what":"호흡이 얕다",
                          "quote":"지금 놓치면 끝이야","dimension":"호흡","confidence":0.8}]
                        """));
        assertThat(mapper.readTree((String) summary.get("uncertainties")))
                .isEqualTo(mapper.readTree("[\"조명이 어둡다\"]"));
        assertThat(mapper.readTree((String) summary.get("raw")).fieldNames()).toIterable()
                .containsExactly("scene_summary", "observations", "uncertainties");

        // 받아쓰기는 SOMA-490 에서 사라졌다 — 대사는 관찰의 quote 로 들어오므로
        // 이 표에 더 쌓이지 않는다. 표 자체는 지난 연습의 기록을 위해 남아 있다.
        assertThat(count("SELECT count(*) FROM transcripts WHERE session_id = ?", sessionId))
                .isZero();

        assertThat(sessionStatus(sessionId)).isEqualTo("analyzed");
        assertThat(jdbc.queryForObject(
                "SELECT updated_at FROM practice_sessions WHERE id = ?",
                java.time.OffsetDateTime.class, sessionId))
                .isEqualTo(NOW.atOffset(ZoneOffset.UTC));

        Map<String, Object> operation = operation(operationId);
        assertThat(operation.get("status")).isEqualTo("succeeded");
        assertThat(operation.get("error_code")).isNull();
        assertThat(operation.get("lease_token")).isNull();
        assertThat(operation.get("lease_expires_at")).isNull();
        JsonNode payload = mapper.readTree((String) operation.get("response_payload"));
        assertThat(payload).isEqualTo(mapper.readTree("""
                {"session_id":"%s","status":"analyzed","summary_id":"%s"}
                """.formatted(sessionId, summaryId)));
    }

    /**
     * 요약을 기다리던 코치 세션은 <b>그 연습의 것만</b> 채워진다. 한 연습에 코치 대화가 여럿
     * 열릴 수 있으므로 갱신은 여러 줄을 친다 — {@code practice_session_id} 조건이 빠지면 남의
     * 연습에서 열린 대화까지 엉뚱한 요약을 물고 간다.
     *
     * <p>📌 <b>같은 SQL 의 {@code summary_id IS NULL} 조건은 여기서 반증할 수 없다.</b>
     * {@code summaries.session_id} 가 UNIQUE 라 한 연습의 요약은 하나뿐이고, 그래서 "이미 다른
     * 요약에 걸린 같은 연습의 코치 세션" 이라는 상태 자체가 만들어지지 않는다. 실제로 일어나지
     * 않는 데이터를 심어 조건을 확인하는 대신, 이 자리에 그렇게 적어 둔다.
     */
    @Test
    void completeLinksTheSummaryToTheWaitingCoachSessionsOfThatPracticeOnly() {
        UUID userId = insertUser();
        UUID sessionId = insertSession(userId, insertFinalizedUpload(userId));
        UUID operationId = insertAnalyzeOperation(userId, sessionId);
        UUID leaseToken = UUID.randomUUID();
        store.claimNext(leaseToken, Duration.ofMinutes(5), NOW.minusSeconds(5));

        UUID waiting = insertCoachSession(sessionId, null);
        UUID alsoWaiting = insertCoachSession(sessionId, null);
        UUID otherPractice = insertSession(userId, insertFinalizedUpload(userId));
        UUID untouched = insertCoachSession(otherPractice, null);

        UUID summaryId = store.complete(operationId, leaseToken, result(), MODEL, NOW);

        assertThat(coachSummaryId(waiting)).isEqualTo(summaryId);
        assertThat(coachSummaryId(alsoWaiting)).isEqualTo(summaryId);
        assertThat(coachSummaryId(untouched)).isNull();
    }

    /**
     * 리스를 잃은 채 끝내려 하면 <b>요약도 대사도 남지 않는다.</b> 원장 갱신이 마지막이라
     * 트랜잭션이 되돌지 않으면 주인 없는 요약이 쌓이고, 재시도가 그것을 또 만든다.
     */
    @Test
    void completeWithAForeignLeaseRollsBackEverythingItHadAlreadyWritten() {
        UUID userId = insertUser();
        UUID sessionId = insertSession(userId, insertFinalizedUpload(userId));
        UUID operationId = insertAnalyzeOperation(userId, sessionId);
        store.claimNext(UUID.randomUUID(), Duration.ofMinutes(5), NOW.minusSeconds(5));

        assertThatThrownBy(() -> store.complete(
                operationId, UUID.randomUUID(), result(), MODEL, NOW))
                .isInstanceOf(LeaseOwnershipException.class);

        assertThat(count("SELECT count(*) FROM summaries WHERE session_id = ?", sessionId))
                .isZero();
        assertThat(count("SELECT count(*) FROM transcripts WHERE session_id = ?", sessionId))
                .isZero();
        assertThat(sessionStatus(sessionId)).isEqualTo("analyzing");
        assertThat(operation(operationId).get("status")).isEqualTo("running");
    }

    /**
     * 분석이 아닌 원장을 분석으로 끝내려는 것은 없음이 아니라 <b>깨진 불변식</b>이다.
     *
     * <p>⚠ 저장소가 던지는 것은 {@code IllegalStateException} 이지만 {@code @Repository} 의
     * 예외 번역이 그것을 {@code DataAccessException} 으로 바꿔 내보낸다. <b>부르는 쪽이
     * {@code IllegalStateException} 을 잡으면 안 잡힌다</b> — {@code AnalysisWorker} 가
     * {@code LeaseOwnershipException} 만 따로 보고 나머지를 {@code Exception} 으로 묶는 것이
     * 그래서 성립한다.
     */
    @Test
    void completeRefusesAnOperationThatIsNotAnAnalysis() {
        UUID userId = insertUser();
        UUID sessionId = insertSession(userId, insertFinalizedUpload(userId));
        UUID reportOperationId = insertOperation(userId, sessionId, "report");

        assertThatThrownBy(() -> store.complete(
                reportOperationId, UUID.randomUUID(), result(), MODEL, NOW))
                .isInstanceOf(DataAccessException.class)
                .hasMessage("external operation not found");

        assertThat(count("SELECT count(*) FROM summaries WHERE session_id = ?", sessionId))
                .isZero();
    }

    @Test
    void expiredUploadSweepReturnsExactlyTheObjectKeysItChanged() {
        UUID userId = insertUser();
        UUID expiredOne = insertPendingUpload(userId, "uploads/expired-one.mp4", NOW.minusSeconds(2));
        UUID expiredTwo = insertPendingUpload(userId, "uploads/expired-two.mp4", NOW.minusSeconds(1));
        UUID active = insertPendingUpload(userId, "uploads/active.mp4", NOW.plusSeconds(1));
        UUID finalized = insertFinalizedUpload(userId);

        assertThat(store.sweepExpiredUploads(NOW))
                .containsExactlyInAnyOrder("uploads/expired-one.mp4", "uploads/expired-two.mp4");
        assertThat(jdbc.queryForMap(
                "SELECT id,status FROM upload_intents WHERE id=?", expiredOne))
                .containsEntry("status", "expired");
        assertThat(jdbc.queryForMap(
                "SELECT id,status FROM upload_intents WHERE id=?", expiredTwo))
                .containsEntry("status", "expired");
        assertThat(jdbc.queryForMap(
                "SELECT id,status FROM upload_intents WHERE id=?", active))
                .containsEntry("status", "pending");
        assertThat(jdbc.queryForMap(
                "SELECT id,status FROM upload_intents WHERE id=?", finalized))
                .containsEntry("status", "finalized");
    }

    private static AnalysisResult result() {
        return new AnalysisResult(
                new ObservationPack(
                        "여자가 문 앞에서 돌아선다.",
                        List.of(new ObservationItem(
                                0, 1200, "호흡이 얕다", "지금 놓치면 끝이야", "호흡", 0.8)),
                        List.of("조명이 어둡다")),
                true);
    }

    private UUID insertUser() {
        UUID id = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO users (id, email, status)
                VALUES (?, ?, 'active')
                """, id, id + "@example.test");
        return id;
    }

    private UUID insertFinalizedUpload(UUID userId) {
        UUID id = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO upload_intents (
                    id, user_id, status, storage_provider, object_key,
                    mime_type, size_bytes, expires_at)
                VALUES (?, ?, 'finalized', 's3', ?, 'video/mp4', 1, ?)
                """, id, userId, "uploads/" + id + ".mp4",
                NOW.plusSeconds(3600).atOffset(ZoneOffset.UTC));
        return id;
    }

    private UUID insertPendingUpload(UUID userId, String objectKey, Instant expiresAt) {
        UUID id = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO upload_intents (
                    id, user_id, status, storage_provider, object_key,
                    mime_type, size_bytes, expires_at)
                VALUES (?, ?, 'pending', 's3', ?, 'video/mp4', 1, ?)
                """, id, userId, objectKey, expiresAt.atOffset(ZoneOffset.UTC));
        return id;
    }

    private UUID insertSession(UUID userId, UUID uploadId) {
        UUID id = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO practice_sessions (
                    id, user_id, upload_intent_id, status, situation,
                    character_context, blockage_kind, sub_branch, goal, updated_at)
                VALUES (?, ?, ?, 'analyzing', '상황', '인물',
                        '분석', '캐릭터 분석', '목표', ?)
                """, id, userId, uploadId, NOW.minusSeconds(60).atOffset(ZoneOffset.UTC));
        return id;
    }

    private UUID insertAnalyzeOperation(UUID userId, UUID sessionId) {
        return insertOperation(userId, sessionId, "analyze");
    }

    private UUID insertOperation(UUID userId, UUID sessionId, String kind) {
        UUID id = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO external_operations (
                    id, session_id, user_id, request_id, kind, status,
                    request_fingerprint, created_at)
                VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)
                """, id, sessionId, userId, UUID.randomUUID(), kind, FINGERPRINT,
                NOW.minusSeconds(30).atOffset(ZoneOffset.UTC));
        return id;
    }

    private UUID insertCoachSession(UUID sessionId, UUID summaryId) {
        UUID id = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO coach_sessions (id, practice_session_id, summary_id)
                VALUES (?, ?, ?)
                """, id, sessionId, summaryId);
        return id;
    }

    private UUID coachSummaryId(UUID coachSessionId) {
        return jdbc.queryForObject(
                "SELECT summary_id FROM coach_sessions WHERE id = ?", UUID.class, coachSessionId);
    }

    private String sessionStatus(UUID sessionId) {
        return jdbc.queryForObject(
                "SELECT status FROM practice_sessions WHERE id = ?", String.class, sessionId);
    }

    private Map<String, Object> operation(UUID operationId) {
        return jdbc.queryForMap("""
                SELECT status, error_code, lease_token, lease_expires_at,
                       response_payload::text AS response_payload
                FROM external_operations WHERE id = ?
                """, operationId);
    }

    private int count(String sql, UUID argument) {
        return jdbc.queryForObject(sql, Integer.class, argument);
    }
}
