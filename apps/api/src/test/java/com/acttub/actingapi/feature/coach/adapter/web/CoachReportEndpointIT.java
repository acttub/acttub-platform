package com.acttub.actingapi.feature.coach.adapter.web;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.coach.adapter.db.CoachStorageFixtures;
import com.acttub.actingapi.feature.coach.domain.CoachTurnSnapshot;
import com.acttub.actingapi.feature.auth.app.JwtService;
import com.acttub.actingapi.integration.llm.GeneratedText;
import com.acttub.actingapi.integration.llm.TextGenerator;
import com.acttub.actingapi.integration.llm.TokenUsage;
import com.acttub.actingapi.platform.operation.ExternalOperationClaimer;
import com.acttub.actingapi.support.PostgresContainerSupport;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

@SpringBootTest(properties = "JWT_SECRET=test-secret")
@AutoConfigureMockMvc
@Import(CoachReportEndpointIT.GeneratorFixture.class)
class CoachReportEndpointIT {

    private static final OffsetDateTime CREATED_AT =
            CoachStorageFixtures.NOW.atOffset(ZoneOffset.UTC);

    private static final String COACH_REPLY =
            "{\"message\":\"질문\",\"status\":\"continue\",\"handoff\":null}";

    private static final String REPORT_BODY = """
            {"report_type":"analysis","title":"생성된 리포트",
             "actor_discovery":"발견","line_meaning":"의미","timing_reason":"타이밍",
             "target_effect":"효과","next_take":{"direction":"방향","tested":false},
             "acting_caution":"주의","evidence":[],"uncertainties":[]}
            """;

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        String name = PostgresContainerSupport.createDatabaseName("coach_report_endpoint");
        registry.add("spring.datasource.url", () -> PostgresContainerSupport.jdbcUrlFor(name));
        registry.add("spring.datasource.username", PostgresContainerSupport.POSTGRES::getUsername);
        registry.add("spring.datasource.password", PostgresContainerSupport.POSTGRES::getPassword);
    }

    @Autowired
    MockMvc mvc;

    @Autowired
    JdbcTemplate jdbc;

    @Autowired
    ObjectMapper mapper;

    @Autowired
    JwtService jwt;

    @Autowired
    RecordingGenerator generator;

    CoachStorageFixtures fixtures;

    @BeforeEach
    void setUp() {
        jdbc.execute("TRUNCATE TABLE users, consent_documents RESTART IDENTITY CASCADE");
        fixtures = new CoachStorageFixtures(jdbc);
        generator.reset();
    }

    @Test
    void resumeReturnsTheOpenSessionWithoutCreatingAnOperationOrCallingLlm() throws Exception {
        UUID userId = fixtures.insertUser();
        CoachStorageFixtures.Practice practice = fixtures.insertPractice(userId);
        UUID summaryId = fixtures.insertSummary(practice.id());
        useValidObservationPack(practice.id());
        UUID sessionId = UUID.randomUUID();
        fixtures.insertCoachSession(sessionId, practice.id(), summaryId, "open", CREATED_AT, List.of(
                new CoachTurnSnapshot("actor", "배우 말"),
                new CoachTurnSnapshot("ai", "저장된 질문")));

        JsonNode response = successful(post("/v2/coach/start")
                .contentType(MediaType.APPLICATION_JSON)
                .header("Authorization", bearer(userId))
                .header("X-Request-Id", UUID.randomUUID())
                .content("""
                        {"practice_session_id":"%s"}
                        """.formatted(practice.id())));

        assertThat(response.path("session_id").textValue()).isEqualTo(sessionId.toString());
        assertThat(response.path("message").textValue()).isEqualTo("저장된 질문");
        assertThat(response.path("turns")).hasSize(2);
        assertThat(generator.callCount()).isZero();
        assertThat(jdbc.queryForObject(
                "SELECT count(*) FROM external_operations", Long.class)).isZero();
    }

    @Test
    void existingReportBlocksResumeAndBypassesBothCreateAndConfirmGeneration() throws Exception {
        UUID userId = fixtures.insertUser();
        CoachStorageFixtures.Practice practice = fixtures.insertPractice(userId);
        UUID summaryId = fixtures.insertSummary(practice.id());
        UUID sessionId = UUID.randomUUID();
        fixtures.insertCoachSession(sessionId, practice.id(), summaryId, "open", CREATED_AT, List.of());
        UUID handoffId = fixtures.insertHandoff(sessionId, practice.id(), CREATED_AT);
        JsonNode report = analysisReport(handoffId);
        insertReport(practice.id(), handoffId, report);

        var resume = mvc.perform(post("/v2/coach/start")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header("Authorization", bearer(userId))
                        .header("X-Request-Id", UUID.randomUUID())
                        .content("""
                                {"practice_session_id":"%s"}
                                """.formatted(practice.id())))
                .andReturn().getResponse();
        assertThat(resume.getStatus()).isEqualTo(409);
        assertThat(mapper.readTree(resume.getContentAsString()).path("detail").textValue())
                .isEqualTo("report already exists for practice session");

        JsonNode created = successful(post("/v2/reports")
                .contentType(MediaType.APPLICATION_JSON)
                .header("Authorization", bearer(userId))
                .header("X-Request-Id", UUID.randomUUID())
                .content("""
                        {"session_id":"%s"}
                        """.formatted(sessionId)));
        assertThat(created).isEqualTo(report);

        JsonNode confirmed = successful(post("/v2/coach/confirm")
                .contentType(MediaType.APPLICATION_JSON)
                .header("Authorization", bearer(userId))
                .header("X-Request-Id", UUID.randomUUID())
                .content("""
                        {"coach_session_id":"%s","confirmed":true}
                        """.formatted(sessionId)));
        assertThat(confirmed.path("report")).isEqualTo(report);
        assertThat(generator.callCount()).isZero();
    }

    @Test
    void confirmParseFailureLeavesConfirmationAndClosedSessionCommitted() throws Exception {
        UUID userId = fixtures.insertUser();
        CoachStorageFixtures.Practice practice = fixtures.insertPractice(userId);
        UUID summaryId = fixtures.insertSummary(practice.id());
        useValidObservationPack(practice.id());
        UUID sessionId = UUID.randomUUID();
        fixtures.insertCoachSession(sessionId, practice.id(), summaryId, "open", CREATED_AT, List.of());
        UUID handoffId = fixtures.insertHandoff(sessionId, practice.id(), CREATED_AT);
        generator.enqueue("not-json");
        UUID requestId = UUID.randomUUID();

        var failed = mvc.perform(post("/v2/coach/confirm")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header("Authorization", bearer(userId))
                        .header("X-Request-Id", requestId)
                        .content("""
                                {"coach_session_id":"%s","confirmed":true}
                                """.formatted(sessionId)))
                .andReturn().getResponse();

        assertThat(failed.getStatus()).isEqualTo(502);
        assertThat(fixtures.coachStatus(sessionId)).isEqualTo("closed");
        assertThat(jdbc.queryForObject("""
                SELECT confirmed FROM handoff_confirmations
                WHERE coaching_handoff_id = ?
                """, Boolean.class, handoffId)).isTrue();
        assertThat(jdbc.queryForMap("""
                SELECT status, error_code
                FROM external_operations WHERE request_id = ?
                """, requestId))
                .containsEntry("status", "failed")
                .containsEntry("error_code", "report_parse_error");

        var reply = mvc.perform(post("/v2/coach/reply")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header("Authorization", bearer(userId))
                        .header("X-Request-Id", UUID.randomUUID())
                        .content("""
                                {"session_id":"%s","text":"계속할게"}
                                """.formatted(sessionId)))
                .andReturn().getResponse();
        assertThat(reply.getStatus()).isEqualTo(409);
        assertThat(mapper.readTree(reply.getContentAsString()).path("detail").textValue())
                .isEqualTo("session is closed");
        assertThat(generator.callCount()).isEqualTo(1);
    }

    /**
     * 대화를 열 수 없는 둘. <b>없는 연습과 아직 안 끝난 연습을 다른 코드로 가른다</b> —
     * 여기 404 는 공백 포함 문장이라 연습 도메인의 {@code practice_session_not_found} 와 표기가
     * 다르다. 라우터별로 어느 표기인지가 계약이다.
     *
     * <p>계약 하네스에서 옮겨 온 기대값이다(SOMA-403 2단계).
     */
    @Test
    void openingACoachSessionNeedsAPracticeThatExistsAndHasSettledItsAnalysis()
            throws Exception {
        UUID userId = fixtures.insertUser();
        CoachStorageFixtures.Practice practice = fixtures.insertPractice(userId);

        assertError(coachStart(userId, UUID.randomUUID(), UUID.randomUUID()),
                404, "practice session not found");

        jdbc.update("""
                UPDATE practice_sessions SET status = 'analyzing' WHERE id = ?
                """, practice.id());
        assertError(coachStart(userId, practice.id(), UUID.randomUUID()),
                409, "practice session analysis is not settled");
    }

    /**
     * 같은 {@code X-Request-Id} 를 처리가 끝나기 전에 다시 보내면 409 다. <b>본문뿐 아니라
     * {@code X-Request-Id} 헤더가 함께 나가는 것</b>까지가 계약이다 — 클라이언트는 그것으로
     * 자기가 무엇을 재전송했는지 안다.
     *
     * <p>하네스는 이것을 LLM 스텁 게이트로 만들었다(첫 요청을 스텁 안에 가둔 채 두 번째를
     * 보낸다). 여기서는 <b>끝난 요청의 원장 행을 처리 중으로 되돌린다</b> — 관측 대상이 인터리빙이
     * 아니라 "그 상태에서 재전송이 어떻게 응답되는가" 이므로 같은 자리를 밟는다.
     */
    @Test
    void replayingWhileTheOperationIsStillRunningIsAConflictThatEchoesTheRequestId()
            throws Exception {
        UUID userId = fixtures.insertUser();
        CoachStorageFixtures.Practice practice = fixtures.insertPractice(userId);
        UUID summaryId = fixtures.insertSummary(practice.id());
        UUID sessionId = UUID.randomUUID();
        fixtures.insertCoachSession(sessionId, practice.id(), summaryId, "open", CREATED_AT,
                List.of());
        UUID handoffId = fixtures.insertHandoff(sessionId, practice.id(), CREATED_AT);
        insertReport(practice.id(), handoffId, analysisReport(handoffId));

        UUID requestId = UUID.randomUUID();
        assertThat(mvc.perform(reports(userId, sessionId, requestId))
                .andReturn().getResponse().getStatus()).isEqualTo(200);

        markRunning(requestId);
        var conflict = mvc.perform(reports(userId, sessionId, requestId))
                .andReturn().getResponse();
        assertThat(conflict.getStatus()).isEqualTo(409);
        assertThat(mapper.readTree(conflict.getContentAsString()).path("detail").textValue())
                .isEqualTo("request is still processing");
        assertThat(conflict.getHeader("X-Request-Id")).isEqualTo(requestId.toString());
    }

    /**
     * 재시도 상한을 소진한 요청은 <b>다시 잡히지 않는다</b>. 처리 중(409 {@code request is
     * still processing})과 다른 코드여야 한다 — 전자는 기다리면 되지만 이것은 기다려도 끝나지
     * 않는다.
     */
    @Test
    void anOperationThatBurnedItsAttemptsIsRejectedAsExhaustedNotAsRunning() throws Exception {
        UUID userId = fixtures.insertUser();
        CoachStorageFixtures.Practice practice = fixtures.insertPractice(userId);
        UUID summaryId = fixtures.insertSummary(practice.id());
        UUID sessionId = UUID.randomUUID();
        fixtures.insertCoachSession(sessionId, practice.id(), summaryId, "open", CREATED_AT,
                List.of());
        UUID handoffId = fixtures.insertHandoff(sessionId, practice.id(), CREATED_AT);
        insertReport(practice.id(), handoffId, analysisReport(handoffId));

        UUID requestId = UUID.randomUUID();
        assertThat(mvc.perform(reports(userId, sessionId, requestId))
                .andReturn().getResponse().getStatus()).isEqualTo(200);

        jdbc.update("""
                UPDATE external_operations
                SET status = 'failed',
                    lease_token = NULL,
                    lease_expires_at = NULL,
                    response_payload = 'null'::jsonb,
                    attempt_count = ?
                WHERE request_id = ?
                """, ExternalOperationClaimer.MAX_EXTERNAL_OPERATION_ATTEMPTS, requestId);

        assertError(reports(userId, sessionId, requestId), 409, "request retry exhausted");
    }

    /**
     * 처리 도중 리스를 빼앗기면 <b>생성하는 네 경로 전부</b>가 409 {@code request is still
     * processing} 이다. 원장이 {@code LeaseOwnershipException} 을 던지는 것은 따로 검증돼
     * 있지만(`ExternalOperationIT`·`PracticeReportLedgerIT`), <b>그것이 이 응답으로 번역되는
     * 자리</b>는 여기서만 확인된다 — 네 곳이 각자 catch 하므로 하나가 빠져도 나머지는 초록이다.
     */
    @Test
    void losingTheLeaseMidFlightIsStillProcessingOnEveryGeneratingRoute() throws Exception {
        UUID starting = fixtures.insertUser();
        CoachStorageFixtures.Practice startPractice = fixtures.insertPractice(starting);
        fixtures.insertSummary(startPractice.id());
        useValidObservationPack(startPractice.id());
        UUID startRequest = UUID.randomUUID();
        generator.duringGeneration(() -> stealLeaseOf(startRequest));
        generator.enqueue(COACH_REPLY);
        int beforeStart = generator.callCount();
        assertError(coachStart(starting, startPractice.id(), startRequest),
                409, "request is still processing");
        assertLostTheLease(startRequest, beforeStart);

        UUID replying = fixtures.insertUser();
        UUID replySession = openCoachSession(replying);
        UUID replyRequest = UUID.randomUUID();
        generator.duringGeneration(() -> stealLeaseOf(replyRequest));
        generator.enqueue(COACH_REPLY);
        int beforeReply = generator.callCount();
        assertError(coachReply(replying, replySession, replyRequest),
                409, "request is still processing");
        assertLostTheLease(replyRequest, beforeReply);

        UUID confirming = fixtures.insertUser();
        UUID confirmSession = openCoachSession(confirming);
        fixtures.insertHandoff(confirmSession, practiceOf(confirmSession), CREATED_AT);
        UUID confirmRequest = UUID.randomUUID();
        generator.duringGeneration(() -> stealLeaseOf(confirmRequest));
        generator.enqueue(REPORT_BODY);
        int beforeConfirm = generator.callCount();
        assertError(coachConfirm(confirming, confirmSession, confirmRequest),
                409, "request is still processing");
        assertLostTheLease(confirmRequest, beforeConfirm);

        UUID reporting = fixtures.insertUser();
        UUID reportSession = openCoachSession(reporting);
        confirmHandoff(fixtures.insertHandoff(
                reportSession, practiceOf(reportSession), CREATED_AT));
        UUID reportRequest = UUID.randomUUID();
        generator.duringGeneration(() -> stealLeaseOf(reportRequest));
        generator.enqueue(REPORT_BODY);
        int beforeReport = generator.callCount();
        assertError(reports(reporting, reportSession, reportRequest),
                409, "request is still processing");
        assertLostTheLease(reportRequest, beforeReport);
    }

    /**
     * 반박 없이 부정 확정을 보내면 422 다. <b>{@code HTTPException} 이 아니라 요청 전체를
     * 훑는 검증</b>이라 {@code loc} 이 {@code ["body"]} 이고 보낸 본문이 그대로 실려 돌아온다 —
     * 파이썬의 model validator 가 그런 모양을 냈다({@code coaching.py:CoachConfirmReq}).
     *
     * <p><b>계약 하네스에서 옮겨 온 기대값이다</b>(SOMA-403 2단계). 인벤토리 검사기는
     * {@code ApiException} 만 세므로 이 부류를 보지 못한다 — 그래서 손으로 옮긴다.
     */
    @Test
    void negativeConfirmationWithoutARebuttalIsAWholeBodyValidationError() throws Exception {
        UUID userId = fixtures.insertUser();
        UUID sessionId = openCoachSession(userId);

        var response = mvc.perform(post("/v2/coach/confirm")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header("Authorization", bearer(userId))
                        .header("X-Request-Id", UUID.randomUUID())
                        .content("{\"coach_session_id\":\"" + sessionId + "\",\"confirmed\":false}"))
                .andReturn().getResponse();

        assertThat(response.getStatus()).isEqualTo(422);
        assertThat(mapper.readTree(response.getContentAsString())).isEqualTo(mapper.readTree("""
                {"detail":[{
                  "type":"value_error",
                  "loc":["body"],
                  "msg":"Value error, rebuttal_text is required when confirmed is false",
                  "input":{"coach_session_id":"%s","confirmed":false},
                  "ctx":{"error":{}}
                }]}
                """.formatted(sessionId)));
        assertThat(generator.callCount()).isZero();
    }

    /**
     * 같은 409 가 다른 이유로도 난다 — 재시도 소진과 처리 중 재생이다. <b>응답만 보면 초록으로
     * 끝나는 길이 셋</b>이라, 이 경로를 실제로 밟았다는 증거를 함께 본다.
     *
     * <p>증거는 원장이 <b>손대지 못한 채 남아 있다</b>는 것이다 — 실행 중이고 실패 기록도 없다.
     * {@code SyncOperationService.fail} 이 소유권 상실을 조용히 삼키기 때문에
     * ({@code claimer.fail} 도 리스로 거르고, 파이썬 {@code fail_sync_operation} 이 그랬다)
     * <b>{@code error_code} 로는 이 경로를 알 수 없다.</b> 다른 두 경로는 애초에 생성까지 가지도
     * 않으므로 LLM 호출 여부가 갈림길이다.
     */
    private void assertLostTheLease(UUID requestId, int callsBefore) {
        assertThat(generator.callCount())
                .as("리스 상실은 생성을 지난 뒤에만 난다")
                .isEqualTo(callsBefore + 1);
        assertThat(jdbc.queryForMap("""
                SELECT status, error_code
                FROM external_operations WHERE request_id = ?
                """, requestId))
                .as("%s 의 원장", requestId)
                .containsEntry("status", "running")
                .containsEntry("error_code", null);
    }

    /**
     * 확인과 저장 <b>사이에</b> 남이 리포트를 만들어 두면 409 {@code report already exists} 다.
     * 저장이 {@code ON CONFLICT DO NOTHING} 이라 조용히 지나가지 않고 그 실패가 응답이 된다.
     *
     * <p><b>계약 하네스에서 옮겨 온 기대값이다</b>(SOMA-403 2단계). 이 문자열을 단언하는 테스트가
     * 하나도 없었다 — 더 긴 {@code report already exists for practice session} 과 겹쳐 있어
     * 문자열만 세면 덮인 것처럼 보인다. <b>둘은 다른 연산의 다른 계약이다.</b>
     *
     * <p>경합은 하네스와 같은 방식으로 고정한다 — 생성이 도는 동안 행을 심는다.
     */
    @Test
    void aReportThatAppearsMidGenerationTurnsBothWritingRoutesIntoAConflict() throws Exception {
        UUID reporting = fixtures.insertUser();
        UUID reportSession = openCoachSession(reporting);
        UUID reportHandoff = fixtures.insertHandoff(
                reportSession, practiceOf(reportSession), CREATED_AT);
        confirmHandoff(reportHandoff);
        generator.duringGeneration(() ->
                insertReport(practiceOf(reportSession), reportHandoff, blockedReport()));
        generator.enqueue(REPORT_BODY);
        assertError(reports(reporting, reportSession, UUID.randomUUID()),
                409, "report already exists");

        UUID confirming = fixtures.insertUser();
        UUID confirmSession = openCoachSession(confirming);
        UUID confirmHandoff = fixtures.insertHandoff(
                confirmSession, practiceOf(confirmSession), CREATED_AT);
        generator.duringGeneration(() ->
                insertReport(practiceOf(confirmSession), confirmHandoff, blockedReport()));
        generator.enqueue(REPORT_BODY);
        assertError(coachConfirm(confirming, confirmSession, UUID.randomUUID()),
                409, "report already exists");
    }

    /** 남의 것이거나 없는 코치 세션으로 성적표를 만들면 404 다 — 연습 쪽 표기와 다르다. */
    @Test
    void creatingAReportForAnUnknownCoachSessionIsSessionNotFound() throws Exception {
        UUID userId = fixtures.insertUser();

        assertError(reports(userId, UUID.randomUUID(), UUID.randomUUID()),
                404, "session not found");
    }

    /**
     * 리포트를 만들다 파싱에 실패하면 502 다. <b>detail 이 예외 메시지 그대로</b>라 고정 문자열이
     * 아니다 — 하네스도 이것만은 값을 비교하지 않고 상태코드와 원장의 {@code error_code} 로
     * 판정했다. 확정 경로는 {@code confirmParseFailure…} 가 이미 보고 있어 여기서는 생성
     * 경로를 본다. 대화 중 완료 턴에서 나는 둘(start·reply)은 {@code CoachServiceTest} 가
     * 서비스 층에서 본다.
     */
    @Test
    void reportParseFailureOnCreateIsBadGatewayAndMarksTheLedger() throws Exception {
        UUID reporting = fixtures.insertUser();
        UUID reportSession = openCoachSession(reporting);
        confirmHandoff(fixtures.insertHandoff(
                reportSession, practiceOf(reportSession), CREATED_AT));
        generator.enqueue("not-json");
        UUID requestId = UUID.randomUUID();

        var failed = mvc.perform(reports(reporting, reportSession, requestId))
                .andReturn().getResponse();
        assertThat(failed.getStatus()).isEqualTo(502);
        assertThat(mapper.readTree(failed.getContentAsString()).path("detail").isTextual())
                .isTrue();
        assertThat(jdbc.queryForObject("""
                SELECT error_code FROM external_operations WHERE request_id = ?
                """, String.class, requestId)).isEqualTo("report_parse_error");
    }

    private JsonNode successful(
            org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder request)
            throws Exception {
        var response = mvc.perform(request).andReturn().getResponse();
        assertThat(response.getStatus()).isEqualTo(200);
        return mapper.readTree(response.getContentAsString());
    }

    private MockHttpServletRequestBuilder coachStart(
            UUID userId, UUID practiceId, UUID requestId) {
        return post("/v2/coach/start")
                .contentType(MediaType.APPLICATION_JSON)
                .header("Authorization", bearer(userId))
                .header("X-Request-Id", requestId)
                .content("{\"practice_session_id\":\"" + practiceId + "\"}");
    }

    private MockHttpServletRequestBuilder coachReply(
            UUID userId, UUID sessionId, UUID requestId) {
        return post("/v2/coach/reply")
                .contentType(MediaType.APPLICATION_JSON)
                .header("Authorization", bearer(userId))
                .header("X-Request-Id", requestId)
                .content("{\"session_id\":\"" + sessionId + "\",\"text\":\"이어서\"}");
    }

    private MockHttpServletRequestBuilder coachConfirm(
            UUID userId, UUID sessionId, UUID requestId) {
        return post("/v2/coach/confirm")
                .contentType(MediaType.APPLICATION_JSON)
                .header("Authorization", bearer(userId))
                .header("X-Request-Id", requestId)
                .content("{\"coach_session_id\":\"" + sessionId + "\",\"confirmed\":true}");
    }

    /** 연습 하나와 그 위의 열린 코치 세션을 세우고 세션 id 를 돌려준다. */
    private UUID openCoachSession(UUID userId) {
        CoachStorageFixtures.Practice practice = fixtures.insertPractice(userId);
        UUID summaryId = fixtures.insertSummary(practice.id());
        useValidObservationPack(practice.id());
        UUID sessionId = UUID.randomUUID();
        fixtures.insertCoachSession(sessionId, practice.id(), summaryId, "open", CREATED_AT,
                List.of(new CoachTurnSnapshot("actor", "배우 말"),
                        new CoachTurnSnapshot("ai", "저장된 질문")));
        return sessionId;
    }

    private UUID practiceOf(UUID coachSessionId) {
        return jdbc.queryForObject(
                "SELECT practice_session_id FROM coach_sessions WHERE id = ?",
                UUID.class,
                coachSessionId);
    }

    /**
     * handoff 를 확정 상태로 만든다.
     *
     * <p><b>{@code /v2/reports} 는 확정되지 않은 handoff 로는 LLM 을 부르지 않는다</b> —
     * {@code ReportEngine.buildReportInput} 이 {@code null} 을 내고 차단 노트가 그대로 200 으로
     * 나간다. 확정을 심지 않으면 생성 경로를 밟는 줄 알았던 테스트가 조용히 다른 길로 간다.
     */
    private void confirmHandoff(UUID handoffId) {
        jdbc.update("""
                INSERT INTO handoff_confirmations(coaching_handoff_id, confirmed)
                VALUES (?, true)
                """, handoffId);
    }

    /**
     * <b>이 요청의</b> 원장 리스를 남의 것으로 만든다.
     *
     * <p>요청 하나로 좁히는 것이 핵심이다 — 실행 중인 행 전부를 치면, 앞선 케이스가 남긴
     * running 행 때문에 "탈취할 것이 있었다" 가 늘 참이 되어 <b>정작 검사 대상이 클레임을 잡지
     * 못했을 때도 픽스처가 통과한다.</b> 이 테스트는 케이스마다 원장을 running 인 채로 남기므로
     * 정확히 그 상황이 만들어진다.
     */
    private void stealLeaseOf(UUID requestId) {
        int updated = jdbc.update("""
                UPDATE external_operations
                SET lease_token = gen_random_uuid()
                WHERE request_id = ? AND status = 'running'
                """, requestId);
        if (updated != 1) {
            throw new AssertionError(
                    "%s 의 실행 중 원장을 찾지 못했다 (%d 건)".formatted(requestId, updated));
        }
    }

    private MockHttpServletRequestBuilder reports(
            UUID userId, UUID sessionId, UUID requestId) {
        return post("/v2/reports")
                .contentType(MediaType.APPLICATION_JSON)
                .header("Authorization", bearer(userId))
                .header("X-Request-Id", requestId)
                .content("{\"session_id\":\"" + sessionId + "\"}");
    }

    /** 끝난 원장 행을 유효한 리스를 쥔 처리 중 상태로 되돌린다. */
    private void markRunning(UUID requestId) {
        jdbc.update("""
                UPDATE external_operations
                SET status = 'running',
                    lease_token = gen_random_uuid(),
                    lease_expires_at = now() + interval '5 minutes',
                    response_payload = 'null'::jsonb
                WHERE request_id = ?
                """, requestId);
    }

    private void assertError(
            MockHttpServletRequestBuilder request, int status, String detail) throws Exception {
        var response = mvc.perform(request).andReturn().getResponse();
        assertThat(response.getStatus())
                .as("기대한 상태코드 %d, detail=%s", status, detail)
                .isEqualTo(status);
        assertThat(mapper.readTree(response.getContentAsString()))
                .isEqualTo(mapper.readTree("{\"detail\":\"" + detail + "\"}"));
    }

    /** 경합 상대가 심는 리포트. 갈래만 맞으면 되므로 최소 형태다. */
    private JsonNode blockedReport() {
        return mapper.createObjectNode()
                .put("report_type", "blocked")
                .put("title", "먼저 들어온 리포트");
    }

    private void insertReport(UUID practiceId, UUID handoffId, JsonNode report) {
        jdbc.update("""
                INSERT INTO practice_reports (
                    id, practice_session_id, report_type, report_json,
                    source_handoff_id, created_at
                ) VALUES (?, ?, 'analysis', ?::jsonb, ?, ?)
                """,
                UUID.randomUUID(),
                practiceId,
                report.toString(),
                handoffId,
                CREATED_AT);
    }

    private void useValidObservationPack(UUID practiceId) {
        jdbc.update("""
                UPDATE summaries
                SET observations_json = ?::jsonb, uncertainties_json = '[]'::jsonb
                WHERE session_id = ?
                """,
                "[{\"start_ms\":0,\"end_ms\":100,\"label\":\"멈춘다\",\"confidence\":0.9}]",
                practiceId);
    }

    private JsonNode analysisReport(UUID handoffId) throws Exception {
        return mapper.readTree("""
                {
                  "report_type":"analysis","title":"기존 리포트",
                  "actor_discovery":"발견","line_meaning":"의미",
                  "timing_reason":"타이밍","target_effect":"효과",
                  "next_take":{"direction":"방향","tested":false},
                  "acting_caution":"주의","evidence":[],"uncertainties":[],
                  "source_handoff_id":"%s"
                }
                """.formatted(handoffId));
    }

    private String bearer(UUID userId) {
        return "Bearer " + jwt.issueAccessToken(userId).value();
    }

    @TestConfiguration
    static class GeneratorFixture {
        @Bean
        @Primary
        RecordingGenerator recordingGenerator() {
            return new RecordingGenerator();
        }
    }

    static final class RecordingGenerator implements TextGenerator {
        private final Deque<String> responses = new ArrayDeque<>();
        private Runnable duringGeneration;
        private int calls;

        @Override
        public synchronized GeneratedText generate(String instructions, String input) {
            calls++;
            // ⚠ 예정에 없던 호출이면 <b>부작용을 일으키기 전에</b> 멈춘다. 순서를 뒤집으면 훅이
            // 먼저 돌아 그 실패(제약 위반·픽스처 단언)가 진짜 원인을 가린다.
            if (responses.isEmpty()) {
                throw new AssertionError("unexpected LLM call");
            }
            if (duringGeneration != null) {
                duringGeneration.run();
            }
            return new GeneratedText(responses.removeFirst(), new TokenUsage(0, 0, 0));
        }

        synchronized void enqueue(String response) {
            responses.addLast(response);
        }

        /**
         * 생성 <b>도중</b>에 끼어들 자리. 클레임을 잡은 뒤 결과를 쓰기 전이라, 여기서 리스를
         * 빼앗으면 하네스의 스텁 게이트가 만들던 상황이 그대로 재현된다.
         */
        synchronized void duringGeneration(Runnable action) {
            this.duringGeneration = action;
        }

        synchronized int callCount() {
            return calls;
        }

        synchronized void reset() {
            responses.clear();
            duringGeneration = null;
            calls = 0;
        }
    }
}
