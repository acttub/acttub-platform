package com.acttub.actingapi.feature.coach.adapter.web;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;

import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import com.acttub.actingapi.feature.auth.app.JwtService;
import com.acttub.actingapi.feature.coach.adapter.db.CoachStorageFixtures;
import com.acttub.actingapi.feature.coach.domain.CoachTurnSnapshot;
import com.acttub.actingapi.integration.llm.GeneratedText;
import com.acttub.actingapi.integration.llm.StructuredJson;
import com.acttub.actingapi.integration.llm.TextGenerator;
import com.acttub.actingapi.integration.llm.TokenUsage;
import com.acttub.actingapi.support.PostgresContainerSupport;
import com.acttub.actingapi.support.RecordingLlmTelemetry;
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
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;

/**
 * account.profile: 코치 대화와 노트가 프로필을 읽는다 — HTTP 로 프로필을 저장하고, 실제 Postgres 를 거쳐,
 * <b>모델 포트가 받은 입력</b>까지 본다.
 *
 * <p>스텁은 모델 하나뿐이다. 프로필 저장소도 코치가 프로필을 읽는 포트도 실물이다 — 여기서 보려는
 * 것이 "설정에서 고친 값이 다음 코치 대화의 입력에 실린다"는 이음 전체이기 때문이다.
 *
 * <p>⚠ 입력이 맞다는 것까지만 본다. 모델이 그 입력으로 잘 말하는지는 실제 모델로 돌리는 eval 과 사람의
 * 의미 검토가 본다.
 */
// 기억 갱신 워커를 끈다. 워커도 같은 모델 포트(여기서는 스텁 큐)를 쓰므로, 앞 테스트가 닫은 대화가 남긴
// 기억 갱신 작업을 워커가 집어 가면 다음 테스트가 큐에 넣은 응답을 먼저 소비한다 — CI 에서 그렇게 502/500 이
// 났다. 워커의 동작은 MemoryUpdateWorkerIT 가 따로 본다.
@SpringBootTest(properties = {"JWT_SECRET=test-secret", "ANALYSIS_WORKER_ENABLED=false"})
@AutoConfigureMockMvc
@Import(CoachReadsProfileIT.GeneratorFixture.class)
class CoachReadsProfileIT {
    private static final OffsetDateTime CREATED_AT = CoachStorageFixtures.NOW.atOffset(ZoneOffset.UTC);
    private static final String COACH_REPLY = "{\"message\":\"질문\",\"status\":\"continue\",\"handoff\":null}";
    private static final String OBSERVATIONS = "[{\"start_ms\":0,\"end_ms\":100,\"what\":\"멈춘다\","
            + "\"quote\":\"가지 마\",\"dimension\":\"호흡\",\"confidence\":0.9}]";
    private static final String REPORT_BODY = """
            {"report_type":"analysis","title":"생성된 리포트",
             "actor_discovery":"발견","line_meaning":"의미","timing_reason":"타이밍",
             "target_effect":"효과","next_take":{"direction":"방향","tested":false},
             "acting_caution":"주의","evidence":[],"uncertainties":[]}
            """;

    /** 다른 어디에도 나오지 않는 이름. 프로필이 어디까지 흘러갔는지 이 글자로 찾는다. */
    private static final String NAME = "프로필에만있는이름";

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        String name = PostgresContainerSupport.createDatabaseName("coach_reads_profile");
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

    @Autowired
    RecordingLlmTelemetry telemetry;

    @Autowired
    com.acttub.actingapi.support.RecordingFailureReporter failures;

    CoachStorageFixtures fixtures;
    UUID user;

    @BeforeEach
    void setUp() throws Exception {
        jdbc.execute("TRUNCATE TABLE users, consent_documents RESTART IDENTITY CASCADE");
        fixtures = new CoachStorageFixtures(jdbc);
        generator.reset();
        telemetry.clear();
        failures.clear();
        user = fixtures.insertUser();
        saveProfile(profile("exam_prep"));
    }

    @Test
    @DisplayName("account.profile: 설정에서 경력을 고친 뒤 새 코치 대화를 시작하면 코치에 넘기는 입력에 고친 값이 들어 있다")
    void accountProfile_experienceChangedInSettingsReachesTheNextCoachConversation() throws Exception {
        generator.enqueue(COACH_REPLY);
        start(legacyPractice(), null);
        assertThat(generator.lastInput()).contains("- 연기 경력: 입시생");

        saveProfile(profile("over_5y"));
        generator.enqueue(COACH_REPLY);
        start(legacyPractice(), null);

        assertThat(generator.lastInput())
                .startsWith("## 배우 프로필\n")
                .contains("- 이름: " + NAME, "- 성별: 여성", "- 만 나이: ", "- 추구하는 방향: 매체(TV·영화)",
                        "- 연기 경력: 5년 이상", "- 최종 목표: 전문 배우")
                .doesNotContain("입시생")
                // 생년월일은 넘기지 않는다. 만 나이만 간다.
                .doesNotContain("2001-03-14");
        assertTheNameStaysOutOfTheTelemetry("- 성별: 여성");
    }

    @Test
    @DisplayName("account.profile: 후속 응답과 재생성도 그 턴에 다시 읽은 프로필을 받는다")
    void accountProfile_replyAndRegenerationCarryTheProfileReadAgainOnThatTurn() throws Exception {
        UUID session = openLegacySession();
        Map<String, Object> changed = profile("y1_to_3");
        changed.put("goal", "hobby");
        saveProfile(changed);
        // 첫 응답은 금지어에 걸려 같은 턴 안에서 다시 만든다.
        generator.enqueue("{\"message\":\"점수로 볼게요\"}");
        generator.enqueue(COACH_REPLY);

        reply(session, null);

        assertThat(generator.inputs()).hasSize(2).allSatisfy(input -> assertThat(input)
                .startsWith("## 배우 프로필\n")
                .contains("- 연기 경력: 1–3년", "- 최종 목표: 취미")
                .doesNotContain("입시생", "전문 배우"));
        assertThat(generator.inputs().get(1)).as("재생성").contains("금지어가 노출됐습니다");
    }

    @Test
    @DisplayName("account.profile: 기억의 성별·나이는 프로필에 자리를 내주고 배우가 말한 목표는 남는다 — 저장된 기억은 그대로다")
    void accountProfile_rememberedGenderAndAgeGiveWayToTheProfileButTheStatedGoalStays() throws Exception {
        Map<String, Object> unspecified = profile("exam_prep");
        unspecified.put("gender", "unspecified");
        unspecified.put("directions", List.of("stage", "media"));
        saveProfile(unspecified);
        for (String[] memory : new String[][] {{"gender", "남"}, {"age", "31"}, {"goal", "입시 합격"}}) {
            jdbc.update("""
                    INSERT INTO actor_memory_entries(id,user_id,field,value,written_by)
                    VALUES (?,?,?,?,'actor')
                    """, UUID.randomUUID(), user, memory[0], memory[1]);
        }
        generator.enqueue(COACH_REPLY);

        start(legacyPractice(), null);

        assertThat(generator.lastInput())
                .contains("- 성별: 선택 안 함", "- 추구하는 방향: 매체(TV·영화), 무대(연극·뮤지컬)")
                .contains("## 배우에 대해 지금까지 알고 있는 것", "- 배우가 말한 목표: 입시 합격")
                // '선택 안 함'이어도 옛 기억의 성별로 보충하지 않는다.
                .doesNotContain("- 성별: 남", "- 나이: 31");
        assertThat(jdbc.queryForList(
                "SELECT field || '=' || value FROM actor_memory_entries WHERE user_id=? ORDER BY field",
                String.class, user))
                .as("모델에 넘기는 사본에서만 뺀다")
                .containsExactly("age=31", "gender=남", "goal=입시 합격");
    }

    @Test
    @DisplayName("account.profile: 구조화 대화와 그 노트는 프로필을 독립 키로 받고, 어디에도 저장하지 않는다")
    void accountProfile_structuredConversationAndItsNoteReceiveTheProfileAsItsOwnKey() throws Exception {
        jdbc.update("""
                INSERT INTO actor_memory_entries(id,user_id,field,value,written_by)
                VALUES (?,?,'gender','남','actor'),(?,?,'goal','입시 합격','actor')
                """, UUID.randomUUID(), user, UUID.randomUUID(), user);
        UUID practice = structuredPractice();
        // 라우팅 경로(dialogue_actions_v2)는 한 턴에 분류 → 생성 두 번 부른다. 프로필은 생성 호출에만 실린다.
        generator.enqueue("{\"route\":\"respond\"}");
        generator.enqueue(structuredDraft("“가지 마”를 듣고 상대가 어떻게 하길 바랐어요?", true));

        JsonNode started = start(practice, "three_layers_v1");

        assertThat(generator.inputs()).as("분류·생성").hasSize(2);
        JsonNode opening = mapper.readTree(generator.inputs().get(1));
        assertThat(opening.path("actor_profile")).isEqualTo(mapper.readTree("""
                {"name":"%s","gender":"여성","age":%d,"directions":["매체(TV·영화)"],
                 "experience":"입시생","goal":"전문 배우"}
                """.formatted(NAME, opening.path("actor_profile").path("age").asInt())));
        assertThat(opening.path("actor_profile").path("age").asInt()).isGreaterThanOrEqualTo(25);
        assertThat(opening.path("prior_context").path("memory"))
                .isEqualTo(mapper.readTree("{\"goal\":\"입시 합격\"}"));
        assertThat(generator.instructions().get(1)).contains("[actor_profile]");
        // 분류는 프로필을 받지 않는다 — 이름이 실리는 호출을 생성 하나로 한정한다.
        assertThat(mapper.readTree(generator.inputs().get(0)).has("actor_profile")).as("분류 입력").isFalse();
        assertThat(generator.instructions().get(0)).doesNotContain("[actor_profile]");

        UUID session = UUID.fromString(started.path("session_id").asText());
        // 마무리 턴은 분류를 건너뛴다: 생성 → 노트.
        generator.enqueue(structuredDraft("오늘 나눈 내용까지만 남겨둘게요.", false));
        generator.enqueue("{\"summary\":[],\"next_take\":null}");

        JsonNode finished = reply(session, "three_layers_v1");

        assertThat(finished.path("status").asText()).isEqualTo("complete");
        JsonNode noteInput = mapper.readTree(generator.lastInput());
        assertThat(noteInput.path("actor_profile").path("experience").asText())
                .as("노트의 모델 입력 — 프로필은 handoff 와 나란히 최상위에 있다")
                .isEqualTo("입시생");
        assertThat(noteInput.path("coach_handoff").has("actor_profile")).isFalse();
        assertThat(noteInput.path("coach_handoff").toString()).doesNotContain(NAME);
        assertThat(generator.lastInstructions()).contains("[actor_profile]", "이번 장면의 목표로 채우지 않는다");
        // 조회 결과는 저장하지 않는 입력이다. 대화·상태·handoff·노트·공개 응답 어디에도 남지 않는다 —
        // 그래서 배우 발화만 읽는 기억 추출로 되먹임되지도 않는다.
        assertThat(finished.toString()).doesNotContain(NAME);
        for (String stored : List.of(
                "SELECT coalesce(string_agg(text, ' '), '') FROM coach_turns",
                "SELECT coalesce(string_agg(coaching_state_json::text, ' '), '') FROM coach_sessions",
                "SELECT coalesce(string_agg(handoff_json::text, ' '), '') FROM coaching_handoffs",
                "SELECT coalesce(string_agg(report_json::text, ' '), '') FROM practice_reports",
                "SELECT coalesce(string_agg(response_payload::text, ' '), '') FROM external_operations")) {
            assertThat(jdbc.queryForObject(stored, String.class)).as(stored).doesNotContain(NAME, "입시생");
        }
        assertTheNameStaysOutOfTheTelemetry("입시생");
    }

    @Test
    @DisplayName("account.profile: 확정으로 만드는 노트와 따로 요청하는 노트가 프로필을 입력 최상위로 받는다")
    void accountProfile_notesFromConfirmAndFromTheReportsRouteReceiveTheProfile() throws Exception {
        UUID confirmed = closableLegacySession();
        generator.enqueue(REPORT_BODY);

        JsonNode confirmation = successful(post("/v2/coach/confirm")
                .contentType(MediaType.APPLICATION_JSON)
                .header("Authorization", bearer()).header("X-Request-Id", UUID.randomUUID())
                .content("{\"coach_session_id\":\"" + confirmed + "\",\"confirmed\":true}"));

        assertProfileAtTheTopOfTheNoteInput("입시생");
        assertThat(confirmation.toString()).doesNotContain(NAME);

        saveProfile(profile("under_1y"));
        UUID requested = closableLegacySession();
        jdbc.update("""
                INSERT INTO handoff_confirmations(coaching_handoff_id, confirmed)
                SELECT id, true FROM coaching_handoffs WHERE coach_session_id=?
                """, requested);
        generator.enqueue(REPORT_BODY);

        JsonNode report = successful(post("/v2/reports")
                .contentType(MediaType.APPLICATION_JSON)
                .header("Authorization", bearer()).header("X-Request-Id", UUID.randomUUID())
                .content("{\"session_id\":\"" + requested + "\"}"));

        assertProfileAtTheTopOfTheNoteInput("1년 미만");
        assertThat(report.toString()).doesNotContain(NAME);
        assertThat(jdbc.queryForObject(
                "SELECT coalesce(string_agg(report_json::text, ' '), '') FROM practice_reports", String.class))
                .as("프로필을 노트 필드로 복사하지 않는다")
                .doesNotContain(NAME, "입시생", "1년 미만");
        assertTheNameStaysOutOfTheTelemetry("여성");
    }

    /**
     * 모델에 보내는 입력은 그대로 두고, 바깥 수탁사(Langfuse)로 나가는 기록에서만 이름을 가린다. 탈퇴가 이름을
     * 파기해도 거기 남은 것은 서버가 지울 수 없다. 나머지 프로필은 입력을 읽는 사람이 맥락을 알 수 있게 남긴다.
     */
    /**
     * 모델에는 이름을 그대로 보내고, 텔레메트리에는 가려 보낸다. 프로필이 실리지 않는 호출(라우팅 경로의 분류)은
     * 어느 쪽에도 프로필이 없다 — 기록에 이름도, 남겨 두는 값도 없어야 한다.
     */
    private void assertTheNameStaysOutOfTheTelemetry(String keptProfileValue) {
        List<String> inputs = generator.inputs();
        assertThat(inputs).as("모델에 보내는 입력").isNotEmpty().anySatisfy(input -> assertThat(input).contains(NAME));
        assertThat(telemetry.calls()).as("텔레메트리로 나가는 입력").hasSameSizeAs(inputs);
        for (int i = 0; i < inputs.size(); i++) {
            String recorded = telemetry.calls().get(i).input();
            assertThat(recorded).as("텔레메트리 %d", i).doesNotContain(NAME);
            if (inputs.get(i).contains(NAME)) {
                assertThat(recorded).as("프로필이 실린 호출 %d 의 기록", i).contains(keptProfileValue);
            } else {
                assertThat(recorded).as("프로필 없는 호출 %d 의 기록", i).doesNotContain(keptProfileValue);
            }
        }
    }

    private void assertProfileAtTheTopOfTheNoteInput(String experience) throws Exception {
        JsonNode input = mapper.readTree(generator.lastInput());
        assertThat(input.path("actor_profile").path("name").asText()).isEqualTo(NAME);
        assertThat(input.path("actor_profile").path("experience").asText()).isEqualTo(experience);
        assertThat(input.path("confirmed_handoff").has("actor_profile")).isFalse();
        assertThat(generator.lastInstructions())
                .contains("[actor_profile]", "프로필의 최종 목표를 이번 장면의 목표로 채우지 않는다");
    }

    // ---- fixtures ----

    private static Map<String, Object> profile(String experience) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("name", NAME);
        body.put("gender", "female");
        body.put("birth_date", "2001-03-14");
        body.put("directions", List.of("media"));
        body.put("experience", experience);
        body.put("goal", "professional");
        return body;
    }

    /** 설정 화면이 하듯 HTTP 로 저장한다. */
    private void saveProfile(Map<String, Object> body) throws Exception {
        assertThat(mvc.perform(put("/v2/me/profile")
                        .header("Authorization", bearer())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(mapper.writeValueAsString(body)))
                .andReturn().getResponse().getStatus()).isEqualTo(200);
    }

    private UUID legacyPractice() {
        CoachStorageFixtures.Practice practice = fixtures.insertPractice(user);
        fixtures.insertSummary(practice.id());
        useValidObservationPack(practice.id());
        return practice.id();
    }

    private UUID structuredPractice() {
        CoachStorageFixtures.Practice practice = fixtures.insertPractice(user);
        UUID summaryId = fixtures.insertSummary(practice.id());
        jdbc.update("UPDATE practice_sessions SET experience_version='three_layers_v1' WHERE id=?", practice.id());
        var record = (com.fasterxml.jackson.databind.node.ObjectNode) StructuredJson.resource("/coaching/record.json");
        record.put("record_id", summaryId.toString());
        jdbc.update("UPDATE summaries SET raw=?::jsonb WHERE session_id=?", record.toString(), practice.id());
        return practice.id();
    }

    private UUID openLegacySession() {
        CoachStorageFixtures.Practice practice = fixtures.insertPractice(user);
        UUID summaryId = fixtures.insertSummary(practice.id());
        useValidObservationPack(practice.id());
        UUID sessionId = UUID.randomUUID();
        fixtures.insertCoachSession(sessionId, practice.id(), summaryId, "open", CREATED_AT,
                List.of(new CoachTurnSnapshot("actor", "배우 말"), new CoachTurnSnapshot("ai", "저장된 질문")));
        return sessionId;
    }

    /** 핸드오프까지 나온 세션 — 확정하거나 노트를 요청하면 모델을 한 번 부른다. */
    private UUID closableLegacySession() {
        CoachStorageFixtures.Practice practice = fixtures.insertPractice(user);
        UUID summaryId = fixtures.insertSummary(practice.id());
        useValidObservationPack(practice.id());
        UUID sessionId = UUID.randomUUID();
        fixtures.insertCoachSession(sessionId, practice.id(), summaryId, "open", CREATED_AT, List.of());
        fixtures.insertHandoff(sessionId, practice.id(), CREATED_AT);
        return sessionId;
    }

    private void useValidObservationPack(UUID practiceId) {
        jdbc.update("""
                UPDATE summaries
                SET raw = ?::jsonb, observations_json = ?::jsonb, uncertainties_json = '[]'::jsonb
                WHERE session_id = ?
                """,
                "{\"scene_summary\":\"문 앞에서 돌아선다.\",\"observations\":" + OBSERVATIONS + ",\"uncertainties\":[]}",
                OBSERVATIONS, practiceId);
    }

    private JsonNode start(UUID practiceId, String contract) throws Exception {
        var request = post("/v2/coach/start")
                .contentType(MediaType.APPLICATION_JSON)
                .header("Authorization", bearer())
                // 새 요청 ID 다 — 같은 ID 는 앞선 응답을 되돌려줄 뿐 모델을 다시 부르지 않는다.
                .header("X-Request-Id", UUID.randomUUID())
                .content("{\"practice_session_id\":\"" + practiceId + "\"}");
        return successful(contract == null ? request : request.header("X-Acttub-Contract", contract));
    }

    private JsonNode reply(UUID sessionId, String contract) throws Exception {
        var request = post("/v2/coach/reply")
                .contentType(MediaType.APPLICATION_JSON)
                .header("Authorization", bearer())
                .header("X-Request-Id", UUID.randomUUID())
                .content("{\"session_id\":\"" + sessionId + "\",\"text\":\"정리해줘\"}");
        return successful(contract == null ? request : request.header("X-Acttub-Contract", contract));
    }

    private JsonNode successful(
            org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder request) throws Exception {
        var response = mvc.perform(request).andReturn().getResponse();
        assertThat(response.getStatus())
                .as(response.getContentAsString() + " reported=" + failures.reports().stream()
                        .map(report -> "[" + report.context() + "] " + report.failure().getClass().getSimpleName() + ": " + report.failure().getMessage()
                                + " @ " + java.util.Arrays.stream(report.failure().getStackTrace()).limit(4)
                                        .map(StackTraceElement::toString).toList()
                                + " inputs=" + generator.inputs().size())
                        .toList())
                .isEqualTo(200);
        return mapper.readTree(response.getContentAsString());
    }

    private String bearer() {
        return "Bearer " + jwt.issueAccessToken(user).value();
    }

    /** 라우팅 경로의 생성 응답(초안). revision·reply_link·flow 는 코드가 조립한다. */
    private static String structuredDraft(String text, boolean opening) {
        var draft = StructuredJson.MAPPER.createObjectNode().put("message", text);
        if (opening) {
            var context = draft.putObject("context_update").putNull("direction").putNull("reading");
            context.putObject("scene_context").putNull("situation").putNull("character_goal").putNull("partner_action");
            context.putArray("open_points");
            var focus = context.putObject("focus").put("label", "가지 마 대사").put("utterance_ref", "u1");
            focus.putArray("evidence_refs").add("u1");
            draft.putArray("evidence_refs").add("u1");
        } else {
            draft.putNull("context_update");
            draft.putArray("evidence_refs");
        }
        return draft.toString();
    }

    @TestConfiguration
    static class GeneratorFixture {
        @Bean
        @Primary
        RecordingGenerator profileRecordingGenerator() {
            return new RecordingGenerator();
        }

        @Bean
        @Primary
        RecordingLlmTelemetry profileRecordingTelemetry() {
            return new RecordingLlmTelemetry();
        }

        /** 엔진이 삼키고 보고만 하는 실패를 붙잡아 둔다 — 502 의 까닭이 단언 메시지에 실린다. */
        @Bean
        @Primary
        com.acttub.actingapi.support.RecordingFailureReporter profileRecordingFailures() {
            return new com.acttub.actingapi.support.RecordingFailureReporter();
        }
    }

    /** 모델 포트의 스텁. 받은 지시문과 입력을 <b>호출마다</b> 남긴다 — 재생성은 한 턴에 두 번 부른다. */
    static final class RecordingGenerator implements TextGenerator {
        private final Deque<String> responses = new ArrayDeque<>();
        private final List<String> instructions = new ArrayList<>();
        private final List<String> inputs = new ArrayList<>();

        @Override
        public synchronized GeneratedText generate(String systemInstructions, String input) {
            instructions.add(systemInstructions);
            inputs.add(input);
            if (responses.isEmpty()) {
                throw new AssertionError("unexpected LLM call");
            }
            return new GeneratedText(responses.removeFirst(), new TokenUsage(0, 0, 0));
        }

        synchronized void enqueue(String response) {
            responses.addLast(response);
        }

        synchronized List<String> inputs() {
            return List.copyOf(inputs);
        }

        synchronized List<String> instructions() {
            return List.copyOf(instructions);
        }

        synchronized String lastInput() {
            return inputs.getLast();
        }

        synchronized String lastInstructions() {
            return instructions.getLast();
        }

        synchronized void reset() {
            responses.clear();
            instructions.clear();
            inputs.clear();
        }
    }
}
