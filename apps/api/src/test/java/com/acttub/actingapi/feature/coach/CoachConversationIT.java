package com.acttub.actingapi.feature.coach;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.auth.app.JwtService;
import com.acttub.actingapi.feature.coach.app.ConversationService;
import com.acttub.actingapi.integration.llm.GeneratedText;
import com.acttub.actingapi.integration.llm.TextGenerator;
import com.acttub.actingapi.integration.llm.TokenUsage;
import com.acttub.actingapi.support.AccountFixtures;
import com.acttub.actingapi.support.PostgresContainerSupport;
import com.acttub.actingapi.support.RecordingFailureReporter;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
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
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

/**
 * practice.coach 의 "검증 방법" 가운데 <b>저장</b>에 해당하는 항목을 HTTP 와 실제 Postgres 로 본다 —
 * {@code coach_conversations}·{@code coach_messages} 의 멱등·충돌·종료다.
 *
 * <p><b>코치의 행동 규칙은 이 티켓이 바꾸지 않았다.</b> 첫 응답 정책·상한·도움 버튼·상태 json 의 출처 분리는
 * {@code CoachEngine}·{@code CoachPrompt} 가 그대로 갖고 있고 기존 테스트(`CoachEngineTest` 등)가 지킨다. 모델은
 * 스텁이라 여기서 보는 것은 "무엇이 어떻게 저장되고 무엇이 거절되는가"다.
 */
@SpringBootTest(properties = {
    "JWT_SECRET=test-secret",
    "ACCOUNT_CLEANUP_ENABLED=false",
    "ACCOUNT_HOUSEKEEPING_ENABLED=false",
    "ANALYSIS_WORKER_ENABLED=false"
})
@AutoConfigureMockMvc
@Import(CoachConversationIT.Fixture.class)
class CoachConversationIT {
    private static final String CONTINUE = "{\"message\":\"무엇이 달라졌나요\",\"status\":\"continue\",\"handoff\":null}";
    private static final String CLOSING =
            "{\"message\":\"오늘은 여기까지 해요\",\"status\":\"complete\",\"handoff\":{\"end_reason\":\"user_ended\"}}";
    /** 종료 턴 뒤에 노트 생성기가 한 번 더 모델을 부른다 — 기존 갈래의 리포트 본문이다. */
    private static final String REPORT = """
            {"report_type":"analysis","title":"생성된 노트",
             "actor_discovery":"발견","line_meaning":"의미","timing_reason":"타이밍",
             "target_effect":"효과","next_take":{"direction":"방향","tested":false},
             "acting_caution":"주의","evidence":[],"uncertainties":[]}
            """;

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        String name = PostgresContainerSupport.createDatabaseName("coach_conversation");
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
    StubGenerator generator;

    private UUID member;
    private String bearer;
    private UUID practice;

    @BeforeEach
    void setUp() {
        jdbc.execute("TRUNCATE TABLE users RESTART IDENTITY CASCADE");
        generator.reset();
        member = member();
        practice = analyzedPractice(member);
        bearer = "Bearer " + jwt.issueAccessToken(member).value();
    }

    @Test
    @DisplayName("practice.coach: 분석이 끝난 회차에서 시작 — coach_conversations 1행(start_request_id)이고 코치 응답 하나가 턴 0 으로 저장된다. "
            + "시작 재전송 — 같은 대화이고 행·턴이 늘지 않는다")
    void practiceCoach_startOpensOneConversationPerPractice() throws Exception {
        generator.enqueue(CONTINUE);
        UUID requestId = UUID.randomUUID();

        JsonNode started = json(post("/v2/coach/start").content(startBody(practice, requestId)), 200);

        JsonNode conversation = started.path("conversation");
        assertThat(conversation.path("status").textValue()).isEqualTo("open");
        assertThat(conversation.path("coach_reply_count").intValue()).isEqualTo(1);
        assertThat(conversation.path("reply_limit").intValue()).isEqualTo(ConversationService.LEGACY_REPLY_LIMIT);
        assertThat(conversation.path("messages")).hasSize(1);
        assertThat(conversation.path("messages").get(0).path("role").textValue()).isEqualTo("coach");
        assertThat(conversation.path("messages").get(0).path("turn_index").intValue()).isZero();
        assertThat(started.path("message").textValue()).isEqualTo("무엇이 달라졌나요");
        assertThat(started.path("note").isNull()).isTrue();
        assertThat(count("coach_conversations")).isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT start_request_id FROM coach_conversations", UUID.class))
                .isEqualTo(requestId);
        assertThat(jdbc.queryForObject("SELECT practice_id FROM coach_conversations", UUID.class)).isEqualTo(practice);
        assertThat(count("coach_messages")).isEqualTo(1);

        JsonNode again = json(post("/v2/coach/start").content(startBody(practice, requestId)), 200);

        assertThat(again.path("conversation").path("id").textValue())
                .isEqualTo(conversation.path("id").textValue());
        assertThat(count("coach_conversations")).isEqualTo(1);
        assertThat(count("coach_messages")).as("재전송이 턴을 늘리지 않는다").isEqualTo(1);
        assertThat(generator.calls()).as("모델을 다시 부르지 않는다").isEqualTo(1);
    }

    @Test
    @DisplayName("practice.coach: 분석이 아직인 회차에서 시작 — 409 analysis_not_ready. 없는 회차·남의 회차 — 404. 답은 300자까지이고 301자는 422 배열")
    void practiceCoach_startNeedsAnAnalyzedPractice() throws Exception {
        UUID analyzing = practice(member, "analyzing");

        assertThat(json(post("/v2/coach/start").content(startBody(analyzing, UUID.randomUUID())), 409))
                .isEqualTo(mapper.readTree("{\"detail\":\"analysis_not_ready\"}"));
        assertThat(count("coach_conversations")).isZero();
        assertThat(json(post("/v2/coach/start").content(startBody(UUID.randomUUID(), UUID.randomUUID())), 404))
                .isEqualTo(mapper.readTree("{\"detail\":\"practice_not_found\"}"));

        generator.enqueue(CONTINUE);
        UUID conversationId = UUID.fromString(json(post("/v2/coach/start")
                .content(startBody(practice, UUID.randomUUID())), 200).path("conversation").path("id").textValue());

        MockHttpServletResponse tooLong = perform(post("/v2/coach/reply").contentType(MediaType.APPLICATION_JSON)
                .content(replyBody(conversationId, UUID.randomUUID(), "가".repeat(301), null)), bearer);
        assertThat(tooLong.getStatus()).isEqualTo(422);
        assertThat(mapper.readTree(tooLong.getContentAsString()).path("detail").isArray()).isTrue();
        assertThat(count("coach_messages")).isEqualTo(1);
    }

    @Test
    @DisplayName("practice.coach: 답 하나를 보냄 — coach_messages 에 배우 1·코치 1 이 turn_index 순으로 쌓이고 revision 이 오른다. "
            + "같은 요청 id 재전송 — 메시지가 늘지 않고 같은 코치 응답. 같은 id·다른 본문 — 422 request_fingerprint_mismatch")
    void practiceCoach_repliesAreIdempotentPerRequestId() throws Exception {
        generator.enqueue(CONTINUE);
        JsonNode started = json(post("/v2/coach/start").content(startBody(practice, UUID.randomUUID())), 200);
        UUID conversationId = UUID.fromString(started.path("conversation").path("id").textValue());
        long revision = started.path("conversation").path("revision").longValue();
        UUID requestId = UUID.randomUUID();
        generator.enqueue("{\"message\":\"그때 무엇을 느꼈나요\",\"status\":\"continue\",\"handoff\":null}");

        JsonNode replied = json(post("/v2/coach/reply")
                .content(replyBody(conversationId, requestId, "숨이 막혔어요", revision)), 200);

        assertThat(replied.path("message").textValue()).isEqualTo("그때 무엇을 느꼈나요");
        assertThat(replied.path("conversation").path("revision").longValue()).isEqualTo(revision + 1);
        assertThat(replied.path("conversation").path("coach_reply_count").intValue()).isEqualTo(2);
        assertThat(jdbc.queryForList("SELECT role FROM coach_messages ORDER BY turn_index", String.class))
                .containsExactly("ai", "actor", "ai");
        assertThat(jdbc.queryForObject(
                "SELECT text FROM coach_messages WHERE role='actor'", String.class)).isEqualTo("숨이 막혔어요");

        JsonNode replayed = json(post("/v2/coach/reply")
                .content(replyBody(conversationId, requestId, "숨이 막혔어요", revision + 1)), 200);

        assertThat(replayed.path("message").textValue()).as("그 요청이 만든 코치 응답 그대로").isEqualTo("그때 무엇을 느꼈나요");
        assertThat(count("coach_messages")).isEqualTo(3);
        assertThat(generator.calls()).as("재전송은 모델을 부르지 않는다").isEqualTo(2);

        assertThat(json(post("/v2/coach/reply")
                .content(replyBody(conversationId, requestId, "다른 말", revision + 1)), 422))
                .isEqualTo(mapper.readTree("{\"detail\":\"request_fingerprint_mismatch\"}"));
        assertThat(count("coach_messages")).isEqualTo(3);
    }

    @Test
    @DisplayName("practice.coach: 대화 중 탈퇴 — 바깥 호출이 도는 사이에 탈퇴가 끝나면 그 뒤 도착한 코치 응답이 "
            + "저장되지 않고 403 account_deactivated 다")
    void practiceCoach_repliesArrivingAfterWithdrawalAreNotStored() throws Exception {
        generator.enqueue(CONTINUE);
        JsonNode started = json(post("/v2/coach/start").content(startBody(practice, UUID.randomUUID())), 200);
        UUID conversationId = UUID.fromString(started.path("conversation").path("id").textValue());
        long revision = started.path("conversation").path("revision").longValue();

        generator.enqueue(CONTINUE);
        // 게이트를 지난 뒤, 모델을 기다리는 사이에 다른 기기의 탈퇴가 커밋된다.
        generator.duringNextCall(() ->
                jdbc.update("UPDATE users SET status='deactivated',deactivated_at=now() WHERE id=?", member));

        assertThat(json(post("/v2/coach/reply")
                .content(replyBody(conversationId, UUID.randomUUID(), "숨이 막혔어요", revision)), 403))
                .isEqualTo(mapper.readTree("{\"detail\":\"account_deactivated\"}"));
        assertThat(count("coach_messages")).as("코치 응답도 배우 메시지도 쌓이지 않는다").isEqualTo(1);
        assertThat(jdbc.queryForObject(
                "SELECT state_revision FROM coach_conversations WHERE id=?", Integer.class, conversationId))
                .isEqualTo((int) revision);
    }

    @Test
    @DisplayName("practice.coach: 낡은 revision 으로 답 — 409 conversation_conflict 이고 아무것도 쌓이지 않는다. 대화 조회로 최신 상태를 다시 읽는다")
    void practiceCoach_staleRevisionsAreRejected() throws Exception {
        generator.enqueue(CONTINUE);
        JsonNode started = json(post("/v2/coach/start").content(startBody(practice, UUID.randomUUID())), 200);
        UUID conversationId = UUID.fromString(started.path("conversation").path("id").textValue());
        long revision = started.path("conversation").path("revision").longValue();
        generator.enqueue(CONTINUE);
        json(post("/v2/coach/reply").content(replyBody(conversationId, UUID.randomUUID(), "첫 답", revision)), 200);

        assertThat(json(post("/v2/coach/reply")
                .content(replyBody(conversationId, UUID.randomUUID(), "낡은 답", revision)), 409))
                .as("그 사이 대화가 움직였다").isEqualTo(mapper.readTree("{\"detail\":\"conversation_conflict\"}"));
        assertThat(count("coach_messages")).isEqualTo(3);
        assertThat(generator.calls()).as("충돌은 모델을 부르기 전에 걸린다").isEqualTo(2);

        JsonNode latest = json(get("/v2/coach/conversations/{id}", conversationId), 200);

        assertThat(latest.path("id").textValue()).isEqualTo(conversationId.toString());
        assertThat(latest.path("practice_id").textValue()).isEqualTo(practice.toString());
        assertThat(latest.path("status").textValue()).isEqualTo("open");
        assertThat(latest.path("revision").longValue()).isEqualTo(revision + 1);
        assertThat(latest.path("messages")).hasSize(3);
        assertThat(latest.path("messages").get(1).path("role").textValue()).isEqualTo("actor");
        assertThat(json(get("/v2/coach/conversations/{id}", UUID.randomUUID()), 404))
                .isEqualTo(mapper.readTree("{\"detail\":\"conversation_not_found\"}"));
        MockHttpServletResponse foreign = perform(get("/v2/coach/conversations/{id}", conversationId),
                "Bearer " + jwt.issueAccessToken(member()).value());
        assertThat(foreign.getStatus()).as("남의 대화").isEqualTo(404);
    }

    @Test
    @DisplayName("practice.coach·practice.note: 대화가 종료로 닫힘 — status closed·close_reason 이 남고 회차의 노트가 한 번 만들어진다. "
            + "닫힌 대화에 답 — 409 conversation_closed 이고 응답이 늘지 않는다. 종료 요청 재전송 — 대화·노트가 늘지 않는다")
    void practiceCoach_closingWritesTheNoteOnceAndRefusesLaterReplies() throws Exception {
        generator.enqueue(CONTINUE);
        JsonNode started = json(post("/v2/coach/start").content(startBody(practice, UUID.randomUUID())), 200);
        UUID conversationId = UUID.fromString(started.path("conversation").path("id").textValue());
        long revision = started.path("conversation").path("revision").longValue();
        generator.enqueue(CONTINUE);
        JsonNode first = json(post("/v2/coach/reply")
                .content(replyBody(conversationId, UUID.randomUUID(), "숨이 막혔어요", revision)), 200);
        generator.enqueue(CONTINUE);
        JsonNode second = json(post("/v2/coach/reply").content(replyBody(
                conversationId, UUID.randomUUID(), "목이 잠겼어요",
                first.path("conversation").path("revision").longValue())), 200);
        long afterFirst = second.path("conversation").path("revision").longValue();
        UUID closingRequest = UUID.randomUUID();
        generator.enqueue(CLOSING);
        generator.enqueue(REPORT);

        JsonNode closed = json(post("/v2/coach/reply")
                .content(replyBody(conversationId, closingRequest, "그만할래요", afterFirst)), 200);

        assertThat(closed.path("conversation").path("status").textValue()).isEqualTo("closed");
        assertThat(closed.path("conversation").path("close_reason").textValue()).isEqualTo("user_ended");
        assertThat(jdbc.queryForMap("SELECT status,close_reason,closed_at FROM coach_conversations"))
                .containsEntry("status", "closed").containsEntry("close_reason", "user_ended");
        assertThat(count("coach_notes")).as("유효 답 둘이라 노트를 만든다").isEqualTo(1);
        assertThat(closed.path("note").path("format").textValue()).isEqualTo("legacy");
        assertThat(closed.at("/note/report/report_type").asText()).isEqualTo("analysis");
        assertThat(closed.at("/note/report/title").asText()).isEqualTo("생성된 노트");
        assertThat(closed.path("note").path("source_revision").longValue())
                .isEqualTo(closed.path("conversation").path("revision").longValue());

        assertThat(json(post("/v2/coach/reply")
                .content(replyBody(conversationId, UUID.randomUUID(), "한 마디만 더", null)), 409))
                .isEqualTo(mapper.readTree("{\"detail\":\"conversation_closed\"}"));
        assertThat(count("coach_messages")).isEqualTo(7);

        JsonNode replayed = json(post("/v2/coach/reply")
                .content(replyBody(conversationId, closingRequest, "그만할래요", afterFirst)), 200);
        assertThat(replayed.path("conversation").path("status").textValue()).isEqualTo("closed");
        assertThat(count("coach_notes")).as("노트는 한 번만 만든다").isEqualTo(1);
        assertThat(count("coach_messages")).isEqualTo(7);
    }

    @Test
    @DisplayName("practice.resume: 노트 없이 대화를 끝내도 회차가 닫히고 같은 영상으로 다음 회차를 시작한다")
    void practiceCoach_closingAlsoClosesThePracticeBeforeContinuing() throws Exception {
        generator.enqueue(CONTINUE);
        JsonNode opened = json(post("/v2/coach/start").content(startBody(practice, UUID.randomUUID())), 200);
        UUID conversation = UUID.fromString(opened.at("/conversation/id").asText());
        generator.enqueue(CLOSING);
        JsonNode closed = json(post("/v2/coach/reply")
                .content(replyBody(conversation, UUID.randomUUID(), "그만", null)), 200);
        assertThat(closed.path("note").isNull()).isTrue();
        JsonNode finishedPractice = json(get("/v2/practices/{id}", practice), 200);
        assertThat(finishedPractice.path("stage").asText()).isEqualTo("closed");
        assertThat(finishedPractice.path("close_reason").asText()).isEqualTo("conversation_closed");
        JsonNode continued = json(post("/v2/practices/{id}/continue", practice)
                .content("{\"request_id\":\"" + UUID.randomUUID() + "\"}"), 201);
        assertThat(continued.path("root_id").asText()).isEqualTo(practice.toString());
        assertThat(continued.path("ordinal").asInt()).isEqualTo(2);
        assertThat(continued.path("stage").asText()).isEqualTo("analyzing");
        assertThat(continued.path("video_id")).isEqualTo(finishedPractice.path("video_id"));
    }

    @Test
    @DisplayName("practice.note: 노트 조회 — 그 회차의 노트가 종류·제목·원문과 함께 온다. 노트가 없는 회차는 404 note_not_found")
    void practiceNote_isReadPerPractice() throws Exception {
        assertThat(json(get("/v2/practices/{id}/note", practice), 404))
                .isEqualTo(mapper.readTree("{\"detail\":\"note_not_found\"}"));

        generator.enqueue(CONTINUE);
        JsonNode started = json(post("/v2/coach/start").content(startBody(practice, UUID.randomUUID())), 200);
        UUID conversationId = UUID.fromString(started.path("conversation").path("id").textValue());
        long revision = started.path("conversation").path("revision").longValue();
        generator.enqueue(CONTINUE);
        long afterOne = json(post("/v2/coach/reply")
                .content(replyBody(conversationId, UUID.randomUUID(), "숨이 막혔어요", revision)), 200)
                .path("conversation").path("revision").longValue();
        generator.enqueue(CONTINUE);
        long afterFirst = json(post("/v2/coach/reply")
                .content(replyBody(conversationId, UUID.randomUUID(), "목이 잠겼어요", afterOne)), 200)
                .path("conversation").path("revision").longValue();
        generator.enqueue(CLOSING);
        generator.enqueue(REPORT);
        json(post("/v2/coach/reply").content(replyBody(conversationId, UUID.randomUUID(), "그만할래요", afterFirst)), 200);

        JsonNode note = json(get("/v2/practices/{id}/note", practice), 200);

        assertThat(note.path("conversation_id").textValue()).isEqualTo(conversationId.toString());
        assertThat(note.path("format").textValue()).isEqualTo("legacy");
        assertThat(note.path("kind").textValue()).as("기존 갈래의 종류를 유지한다").isIn("analysis", "expression");
        assertThat(note.path("fallback").booleanValue()).isFalse();
        assertThat(note.path("report").isNull()).as("옛 공개 필드를 읽던 화면을 위해 원문을 함께 준다").isFalse();
        MockHttpServletResponse foreign = perform(get("/v2/practices/{id}/note", practice),
                "Bearer " + jwt.issueAccessToken(member()).value());
        assertThat(foreign.getStatus()).isEqualTo(404);
    }

    @Test
    @DisplayName("practice.note: 유효한 배우 답이 하나뿐인 채 종료 — 기존 갈래는 노트를 만들지 않는다(연습 기록에 \"아직 정리 없음\")")
    void practiceNote_legacyNeedsTwoAnswers() throws Exception {
        generator.enqueue(CONTINUE);
        JsonNode started = json(post("/v2/coach/start").content(startBody(practice, UUID.randomUUID())), 200);
        UUID conversationId = UUID.fromString(started.path("conversation").path("id").textValue());
        long revision = started.path("conversation").path("revision").longValue();
        generator.enqueue(CLOSING);
        generator.enqueue(REPORT);

        JsonNode closed = json(post("/v2/coach/reply")
                .content(replyBody(conversationId, UUID.randomUUID(), "그만할래요", revision)), 200);

        assertThat(closed.path("conversation").path("status").textValue()).isEqualTo("closed");
        assertThat(closed.path("note").isNull()).isTrue();
        assertThat(count("coach_notes")).isZero();
        assertThat(json(get("/v2/practices/{id}/note", practice), 404))
                .isEqualTo(mapper.readTree("{\"detail\":\"note_not_found\"}"));
    }

    // ---- helpers ----

    @Test
    void practiceCoach_replayKeepsTheOriginalOutcomeAfterLaterTurnsAndClosing() throws Exception {
        generator.enqueue(CONTINUE);
        UUID conversation = UUID.fromString(json(post("/v2/coach/start").content(startBody(practice, UUID.randomUUID())), 200)
                .at("/conversation/id").asText());
        UUID request = UUID.randomUUID();
        String originalBody = replyBody(conversation, request, "숨이 막혔어요", 1L);
        generator.enqueue(CONTINUE);
        JsonNode original = json(post("/v2/coach/reply").content(originalBody), 200);
        generator.enqueue(CONTINUE);
        json(post("/v2/coach/reply").content(replyBody(conversation, UUID.randomUUID(), "목이 잠겼어요", null)), 200);
        generator.enqueue(CLOSING);
        generator.enqueue(REPORT);
        json(post("/v2/coach/reply").content(replyBody(conversation, UUID.randomUUID(), "그만할래요", null)), 200);
        int calls = generator.calls();

        JsonNode replayed = json(post("/v2/coach/reply").content(originalBody), 200);

        assertThat(replayed).isEqualTo(original);
        assertThat(generator.calls()).isEqualTo(calls);
    }

    @Test
    void practiceNote_legacyClosingFallbackDoesNotPersistABlockedReportAsANote() throws Exception {
        generator.enqueue(CONTINUE);
        UUID conversation = UUID.fromString(json(post("/v2/coach/start").content(startBody(practice, UUID.randomUUID())), 200)
                .at("/conversation/id").asText());
        generator.enqueue(CONTINUE);
        json(post("/v2/coach/reply").content(replyBody(conversation, UUID.randomUUID(), "숨이 막혔어요", null)), 200);
        generator.enqueue(CONTINUE);
        json(post("/v2/coach/reply").content(replyBody(conversation, UUID.randomUUID(), "목이 잠겼어요", null)), 200);
        generator.enqueue("{\"message\":\"점수로 볼게요\",\"status\":\"continue\",\"handoff\":null}");
        generator.enqueue("{\"message\":\"점수로 볼게요\",\"status\":\"continue\",\"handoff\":null}");

        JsonNode closed = json(post("/v2/coach/reply").content(replyBody(conversation, UUID.randomUUID(), "그만할래요", null)), 200);

        assertThat(closed.at("/conversation/status").asText()).isEqualTo("closed");
        assertThat(closed.path("note").isNull()).isTrue();
        assertThat(count("coach_notes")).isZero();
        assertThat(generator.calls()).isEqualTo(5);
    }

    @Test
    void practiceCoach_withdrawalWhileOpeningDoesNotSaveTheFirstMessage() throws Exception {
        generator.enqueue(CONTINUE);
        generator.duringNextCall(() -> jdbc.update(
                "UPDATE users SET status='deactivated',deactivated_at=now() WHERE id=?", member));

        JsonNode denied = json(post("/v2/coach/start").content(startBody(practice, UUID.randomUUID())), 403);

        assertThat(denied.path("detail").asText()).isEqualTo("account_deactivated");
        assertThat(count("coach_messages")).isZero();
    }

    @Test
    void practiceNote_withdrawalDuringGenerationDoesNotSaveALateNote() throws Exception {
        generator.enqueue(CONTINUE);
        JsonNode opened = json(post("/v2/coach/start").content(startBody(practice, UUID.randomUUID())), 200);
        UUID conversation = UUID.fromString(opened.at("/conversation/id").asText());
        generator.enqueue(CONTINUE);
        json(post("/v2/coach/reply").content(replyBody(conversation, UUID.randomUUID(), "숨이 막혔어요", null)), 200);
        generator.enqueue(CONTINUE);
        json(post("/v2/coach/reply").content(replyBody(conversation, UUID.randomUUID(), "목이 잠겼어요", null)), 200);
        generator.enqueue(CLOSING);
        generator.enqueue(REPORT);
        generator.duringNextCall(() -> generator.duringNextCall(() -> jdbc.update(
                "UPDATE users SET status='deactivated',deactivated_at=now() WHERE id=?", member)));

        JsonNode denied = json(post("/v2/coach/reply").content(replyBody(conversation, UUID.randomUUID(), "그만할래요", null)), 403);

        assertThat(denied.path("detail").asText()).isEqualTo("account_deactivated");
        assertThat(count("coach_notes")).isZero();
    }

    private String startBody(UUID practiceId, UUID requestId) {
        return "{\"practice_id\":\"" + practiceId + "\",\"request_id\":\"" + requestId + "\"}";
    }

    private String replyBody(UUID conversationId, UUID requestId, String text, Long revision) {
        return "{\"conversation_id\":\"" + conversationId + "\",\"request_id\":\"" + requestId
                + "\",\"text\":\"" + text + "\""
                + (revision == null ? "" : ",\"revision\":" + revision) + "}";
    }

    private UUID member() {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO users(id,status) VALUES (?,'active')", id);
        jdbc.update("INSERT INTO user_identities(id,user_id,provider,provider_uid) VALUES (?,?,'google',?)",
                UUID.randomUUID(), id, "g-" + id);
        AccountFixtures.passGate(jdbc, id);
        return id;
    }

    /** 분석이 끝나 대화를 열 수 있는 회차. 회차·분석 API 는 PA2·PA3 의 것이라 행을 직접 넣는다. */
    private UUID analyzedPractice(UUID owner) {
        UUID id = practice(owner, "conversing");
        jdbc.update("""
                INSERT INTO analyses(id,practice_id,format,status,model,record,completed_at)
                VALUES (?,?,'legacy','ready','test-model',CAST(? AS jsonb),now())
                """, UUID.randomUUID(), id,
                "{\"scene_summary\":\"문 앞에서 돌아선다\",\"observations\":[],\"uncertainties\":[]}");
        return id;
    }

    private UUID practice(UUID owner, String stage) {
        UUID videoId = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO videos(id,user_id,object_key,content_type,byte_size,duration_ms)
                VALUES (?,?,?,'video/mp4',1000,12000)
                """, videoId, owner, "videos/" + owner + "/" + videoId + ".mp4");
        UUID id = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO practices(id,user_id,video_id,root_id,ordinal,stage,experience_version,
                                      blockage_kind,sub_branch,situation)
                VALUES (?,?,?,?,1,?,'legacy','분석','캐릭터 분석','문 앞에서 돌아선다')
                """, id, owner, videoId, id, stage);
        return id;
    }

    private MockHttpServletResponse perform(MockHttpServletRequestBuilder request, String authorization)
            throws Exception {
        return mvc.perform(request.header("Authorization", authorization)).andReturn().getResponse();
    }

    private JsonNode json(MockHttpServletRequestBuilder request, int status) throws Exception {
        var response = perform(request.contentType(MediaType.APPLICATION_JSON), bearer);
        assertThat(response.getStatus()).as(response.getContentAsString()).isEqualTo(status);
        String body = response.getContentAsString();
        return body.isEmpty() ? mapper.nullNode() : mapper.readTree(body);
    }

    private int count(String table) {
        return jdbc.queryForObject("SELECT count(*) FROM " + table, Integer.class);
    }

    @TestConfiguration(proxyBeanMethods = false)
    static class Fixture {
        @Bean
        @Primary
        StubGenerator stubGenerator() {
            return new StubGenerator();
        }

        @Bean
        @Primary
        RecordingFailureReporter recordingFailureReporter() {
            return new RecordingFailureReporter();
        }
    }

    /** 모델 포트의 스텁. 시험이 미리 넣어 둔 응답을 차례로 낸다. */
    static final class StubGenerator implements TextGenerator {
        private final Deque<String> responses = new ArrayDeque<>();
        private final List<String> inputs = new ArrayList<>();
        /** 바깥 호출이 도는 사이에 일어나는 일(탈퇴·이관)을 세우는 자리다. */
        private volatile Runnable duringCall;

        @Override
        public synchronized GeneratedText generate(String systemInstructions, String input) {
            inputs.add(input);
            if (responses.isEmpty()) {
                throw new IllegalStateException("unexpected LLM call #" + inputs.size());
            }
            Runnable hook = duringCall;
            duringCall = null;
            if (hook != null) {
                hook.run();
            }
            return new GeneratedText(responses.removeFirst(), new TokenUsage(0, 0, 0));
        }

        synchronized void enqueue(String response) {
            responses.addLast(response);
        }

        /** 다음 호출이 응답을 내기 직전에 한 번 돈다. */
        void duringNextCall(Runnable hook) {
            duringCall = hook;
        }

        synchronized int calls() {
            return inputs.size();
        }

        synchronized void reset() {
            responses.clear();
            inputs.clear();
            duringCall = null;
        }
    }
}
