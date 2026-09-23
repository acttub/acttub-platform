package com.acttub.actingapi.feature.coach.adapter.web;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import com.acttub.actingapi.feature.auth.app.JwtService;
import com.acttub.actingapi.feature.coach.adapter.db.CoachStorageFixtures;
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
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.junit.jupiter.params.provider.CsvSource;
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
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;

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

    @Autowired
    com.acttub.actingapi.platform.migration.PracticeDataMigration migration;

    @Autowired
    com.acttub.actingapi.feature.coach.app.NoteWriter notes;

    @Autowired
    com.acttub.actingapi.feature.coach.app.ConversationRepository conversations;

    @MockitoSpyBean
    com.acttub.actingapi.feature.coach.app.CoachProfile profiles;

    @MockitoSpyBean
    com.acttub.actingapi.feature.coach.app.CoachMemory memory;

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
        startPractice(analyzedPractice());
        assertThat(generator.lastInput()).contains("- 연기 경력: 입시생");

        saveProfile(profile("over_5y"));
        generator.enqueue(COACH_REPLY);
        startPractice(analyzedPractice());

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
        rememberGoal();
        generator.enqueue(COACH_REPLY);

        startPractice(analyzedPractice());

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
        rememberGoal();
        UUID practice = structuredPractice();
        // 라우팅 경로(dialogue_actions_v2)는 한 턴에 분류 → 생성 두 번 부른다. 프로필은 생성 호출에만 실린다.
        generator.enqueue("{\"route\":\"respond\"}");
        generator.enqueue(structuredDraft("“가지 마”를 듣고 상대가 어떻게 하길 바랐어요?", true));

        JsonNode started = startPractice(practice);

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

        UUID session = UUID.fromString(started.path("conversation").path("id").asText());
        JsonNode resumed = successful(get("/v2/coach/conversations/{id}", session).header("Authorization", bearer()));
        assertThat(resumed.path("reply_limit").asInt()).as("신형 대화 재조회도 10회 상한이다").isEqualTo(10);
        // 마무리 턴은 분류를 건너뛴다: 생성 → 노트.
        generator.enqueue(structuredDraft("오늘 나눈 내용까지만 남겨둘게요.", false));
        generator.enqueue("{\"summary\":[],\"next_take\":null}");

        JsonNode finished = reply(session, "three_layers_v1");

        assertThat(finished.path("conversation").path("status").asText()).isEqualTo("closed");
        assertThat(finished.path("note").path("report").path("schema_version").asText())
                .isEqualTo("acttub.public_practice_note.v1");
        assertThat(finished.path("note").path("report").has("source_catalog")).isFalse();
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
                "SELECT coalesce(string_agg(text, ' '), '') FROM coach_messages",
                "SELECT coalesce(string_agg(state::text, ' '), '') FROM coach_conversations",
                "SELECT coalesce(string_agg(legacy_report::text, ' '), '') FROM coach_notes",
                "SELECT coalesce(string_agg(response_payload::text, ' '), '') FROM external_operations")) {
            assertThat(jdbc.queryForObject(stored, String.class)).as(stored).doesNotContain(NAME, "입시생");
        }
        assertTheNameStaysOutOfTheTelemetry("입시생");
    }

    @Test
    @DisplayName("account.profile: 종료 노트는 최신 프로필을 입력으로 받고 저장된 노트 조회는 다시 생성하지 않는다")
    void accountProfile_closingNoteReceivesProfileAndReadingItDoesNotRegenerate() throws Exception {
        UUID practice = analyzedPractice();
        UUID conversation = insertConversation(practice, List.of("첫 질문", "숨이 막혔어요", "그 다음은요", "목이 잠겼어요"));
        generator.enqueue("{\"message\":\"오늘은 여기까지 해요\",\"status\":\"complete\",\"handoff\":{\"end_reason\":\"user_ended\"}}");
        generator.enqueue(REPORT_BODY);

        JsonNode closed = reply(conversation, null);

        assertProfileAtTheTopOfTheNoteInput("입시생");
        assertThat(closed.path("note").isNull()).isFalse();
        assertThat(closed.toString()).doesNotContain(NAME);
        int calls = generator.inputs().size();
        saveProfile(profile("under_1y"));
        JsonNode note = successful(get("/v2/practices/{id}/note", practice).header("Authorization", bearer()));
        assertThat(note).isEqualTo(closed.path("note"));
        assertThat(generator.inputs()).hasSize(calls);
        assertThat(jdbc.queryForObject(
                "SELECT coalesce(string_agg(legacy_report::text, ' '), '') FROM coach_notes", String.class))
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

    @Test
    @DisplayName("practice.coach: 첫 모델 호출 실패는 502이고 같은 시작 요청으로 다시 시작할 수 있다")
    void practiceCoach_failedOpeningCanRetryWithoutSavingAFakeMessage() throws Exception {
        UUID practice = structuredPractice();
        String opening = mapper.writeValueAsString(Map.of("practice_id", practice, "request_id", UUID.randomUUID()));
        generator.enqueue("{\"route\":\"invalid-route\"}");
        var failed = mvc.perform(post("/v2/coach/start").header("Authorization", bearer())
                .contentType(MediaType.APPLICATION_JSON).content(opening)).andReturn().getResponse();
        assertThat(failed.getStatus()).as(failed.getContentAsString()).isEqualTo(502);
        assertThat(mapper.readTree(failed.getContentAsString()).path("detail").asText()).isEqualTo("coach_response_unavailable");
        assertThat(jdbc.queryForObject("SELECT count(*) FROM coach_messages", Integer.class)).isZero();

        generator.enqueue("{\"route\":\"respond\"}");
        generator.enqueue(structuredDraft("“가지 마”를 듣고 상대가 어떻게 하길 바랐어요?", true));
        JsonNode recovered = successful(post("/v2/coach/start").header("Authorization", bearer())
                .contentType(MediaType.APPLICATION_JSON).content(opening));
        assertThat(recovered.at("/conversation/messages")).hasSize(1);
        assertThat(recovered.path("message").asText()).isEqualTo("“가지 마”를 듣고 상대가 어떻게 하길 바랐어요?");

        generator.enqueue("{\"route\":\"invalid-route\"}");
        var reply = mvc.perform(post("/v2/coach/reply").header("Authorization", bearer()).contentType(MediaType.APPLICATION_JSON)
                .content(mapper.writeValueAsString(Map.of("conversation_id", recovered.at("/conversation/id").asText(),
                        "request_id", UUID.randomUUID(), "text", "상대가 남아 있으면 좋겠어요"))))
                .andReturn().getResponse();
        assertThat(reply.getStatus()).as(reply.getContentAsString()).isEqualTo(502);
        JsonNode unchanged = successful(get("/v2/coach/conversations/{id}", recovered.at("/conversation/id").asText())
                .header("Authorization", bearer()));
        assertThat(unchanged.path("messages")).hasSize(1);
        assertThat(unchanged.path("revision")).isEqualTo(recovered.at("/conversation/revision"));
    }

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    @DisplayName("practice.note: 신형 노트 생성 두 번 실패는 근거를 보존한 fallback 노트 하나이고 재전송은 생성하지 않는다")
    void practiceNote_generationRetryKeepsEvidenceAndMarksOnlyFinalFallback(boolean recovers) throws Exception {
        UUID practice = structuredPractice();
        generator.enqueue("{\"route\":\"respond\"}");
        generator.enqueue(structuredDraft("“가지 마”를 듣고 상대가 어떻게 하길 바랐어요?", true));
        JsonNode started = startPractice(practice);
        String closing = mapper.writeValueAsString(Map.of("conversation_id", started.at("/conversation/id").asText(),
                "request_id", UUID.randomUUID(), "text", "정리해줘"));
        generator.enqueue(structuredDraft("오늘 나눈 내용까지만 남겨둘게요.", false));
        generator.enqueue("not valid JSON");
        generator.enqueue(recovers ? "{\"summary\":[],\"next_take\":null}" : "not valid JSON again");

        JsonNode ended = successful(post("/v2/coach/reply").header("Authorization", bearer())
                .contentType(MediaType.APPLICATION_JSON).content(closing));

        assertThat(ended.at("/note/fallback").asBoolean()).isEqualTo(!recovers);
        assertThat(ended.at("/note/kind").asText()).isEqualTo("observation");
        assertThat(ended.at("/note/title").asText()).isEqualTo("가지 마 대사");
        assertThat(ended.at("/note/next_take").isNull()).isTrue();
        long noteCalls = generator.inputs().stream().filter(input -> input.contains("\"coach_handoff\"")).count();
        assertThat(noteCalls).as("노트 생성은 재시도 포함 두 번까지만").isEqualTo(2);
        int calls = generator.inputs().size();
        JsonNode replay = successful(post("/v2/coach/reply").header("Authorization", bearer())
                .contentType(MediaType.APPLICATION_JSON).content(closing));
        assertThat(replay.path("note")).isEqualTo(ended.path("note"));
        assertThat(generator.inputs()).hasSize(calls);
    }

    @Test
    @DisplayName("practice.note: 다음 촬영에는 배우의 방향이 아니라 실제 촬영 제안을 저장하고 보여 준다")
    void practiceNote_nextTakeKeepsTheProposedActionDistinctFromActorDirection() throws Exception {
        UUID practice = structuredPractice();
        UUID conversation = insertConversation(practice, List.of());
        var handoff = (com.fasterxml.jackson.databind.node.ObjectNode) StructuredJson.resource("/coaching/handoff.json");
        var loaded = conversations.loadByConversation(user, conversation);
        var ended = loaded.session().withCoachingState("three_layers_v1", 3,
                handoff.path("coaching_state"), "closed", "user_ended");
        generator.enqueue("{\"title\":\"말끝\",\"summary\":null}");
        notes.write(loaded, new com.acttub.actingapi.feature.coach.app.CoachResult(ended,
                new com.acttub.actingapi.feature.coach.app.CoachReply("여기까지 남길게요", "complete", handoff)),
                3, CoachStorageFixtures.NOW);

        JsonNode note = successful(get("/v2/practices/{id}/note", practice).header("Authorization", bearer()));

        assertThat(note.path("kind").asText()).isEqualTo("action");
        assertThat(note.path("next_take").asText()).isEqualTo("같은 대사를 말끝만 짧게 끝내서 한 번 해보세요.");
        assertThat(note.path("next_take")).isNotEqualTo(note.at("/report/direction/text"));
        assertThat(note.at("/report/practice/instruction").asText()).isEqualTo(note.path("next_take").asText());
    }

    @ParameterizedTest
    @CsvSource({"true,false", "true,true", "false,false", "false,true"})
    @DisplayName("practice.coach: 프로필·기억 조회 실패를 원인·분류와 함께 보고하고 시작·후속 응답을 계속한다")
    void practiceCoach_contextFailureIsReportedAndDoesNotBlockTheTurn(boolean failProfile, boolean followup) throws Exception {
        UUID practice = analyzedPractice();
        UUID conversation = null;
        if (followup) {
            generator.enqueue(COACH_REPLY);
            conversation = UUID.fromString(startPractice(practice).at("/conversation/id").asText());
            generator.reset();
        }
        RuntimeException failure = failProfile ? new IllegalStateException("profile value invalid")
                : new org.springframework.dao.DataAccessResourceFailureException("memory database unavailable");
        if (failProfile) {
            org.mockito.Mockito.doThrow(failure).when(profiles).completeFor(user);
        } else {
            org.mockito.Mockito.doThrow(failure).when(memory).priorForPractice(
                    org.mockito.ArgumentMatchers.eq(user), org.mockito.ArgumentMatchers.any(UUID.class),
                    org.mockito.ArgumentMatchers.isNull());
        }
        generator.enqueue(COACH_REPLY);
        JsonNode answer = followup
                ? successful(post("/v2/coach/reply").contentType(MediaType.APPLICATION_JSON)
                        .header("Authorization", bearer()).content(mapper.writeValueAsString(Map.of(
                                "conversation_id", conversation, "request_id", UUID.randomUUID(), "text", "숨이 막혔어요"))))
                : startPractice(practice);
        assertThat(answer.path("message").asText()).isEqualTo("질문");
        assertThat(failures.reports()).singleElement().satisfies(report -> {
            Throwable origin = report.failure();
            while (origin.getCause() != null) origin = origin.getCause();
            assertThat(origin).isSameAs(failure);
            assertThat(report.kind()).isEqualTo(failProfile
                    ? com.acttub.actingapi.platform.observability.FailureKind.UNEXPECTED
                    : com.acttub.actingapi.platform.observability.FailureKind.EXTERNAL);
            assertThat(report.context()).isEqualTo(failProfile ? "ConversationService.actorProfile" : "ConversationService.priorContext");
        });
        if (failProfile) assertThat(generator.lastInput()).doesNotContain("## 배우 프로필");
        else assertThat(generator.lastInput()).contains("## 배우 프로필");
    }

    @Test
    @DisplayName("practice.analyze: 새 회차의 관찰을 공개 요약으로 읽고 남의 회차와 없는 회차는 같은 404다")
    void practiceAnalysis_readsTheOwnedPublicSummary() throws Exception {
        UUID practice = analyzedPractice();
        JsonNode analysis = successful(get("/v2/practices/{id}/analysis", practice).header("Authorization", bearer()));
        assertThat(analysis.path("format").asText()).isEqualTo("legacy");
        assertThat(analysis.path("status").asText()).isEqualTo("ready");
        assertThat(analysis.at("/summary/observations/0/label").asText()).isEqualTo("멈춘다");
        assertThat(analysis.has("record")).isFalse();
        jdbc.update("DELETE FROM analyses WHERE practice_id=?", practice);
        var pending = mvc.perform(get("/v2/practices/{id}/analysis", practice).header("Authorization", bearer()))
                .andReturn().getResponse();
        assertThat(pending.getStatus()).isEqualTo(404);
        assertThat(mapper.readTree(pending.getContentAsString()).path("detail").asText()).isEqualTo("analysis_not_found");

        UUID other = fixtures.insertUser();
        com.acttub.actingapi.support.AccountFixtures.passGate(jdbc, other);
        for (UUID id : List.of(practice, UUID.randomUUID())) {
            var response = mvc.perform(get("/v2/practices/{id}/analysis", id)
                    .header("Authorization", "Bearer " + jwt.issueAccessToken(other).value())).andReturn().getResponse();
            assertThat(response.getStatus()).isEqualTo(404);
            assertThat(mapper.readTree(response.getContentAsString()).path("detail").asText()).isEqualTo("practice_not_found");
        }
    }

    @Test
    void practiceAnalysis_structuredRecordIsReadAsAPublicSummary() throws Exception {
        JsonNode analysis = successful(get("/v2/practices/{id}/analysis", structuredPractice())
                .header("Authorization", bearer()));
        assertThat(analysis.path("format").asText()).isEqualTo("video_record_v1");
        assertThat(analysis.at("/summary/schema_version").asText()).isEqualTo("acttub.video_record_summary.v1");
        assertThat(analysis.at("/summary/record_id")).isEqualTo(analysis.path("id"));
        assertThat(analysis.at("/summary/processed_ranges").isArray()).isTrue();
        assertThat(analysis.path("summary").has("segments")).isFalse();
        assertThat(analysis.path("summary").has("source_catalog")).isFalse();
    }

    @ParameterizedTest
    @ValueSource(strings = {"{}", "null", "[]", "{\"observations\":null}", "{\"legacy\":true}"})
    void practiceAnalysis_legacySplitObservationsRemainReadable(String raw) throws Exception {
        UUID practice = fixtures.insertPractice(user).id();
        fixtures.insertSummary(practice);
        jdbc.update("UPDATE summaries SET raw=CAST(? AS jsonb) WHERE session_id=?", raw, practice);
        JsonNode analysis = successful(get("/v2/practices/{id}/analysis", practice).header("Authorization", bearer()));
        assertThat(analysis.path("format").asText()).isEqualTo("legacy");
        assertThat(analysis.at("/summary/observations/0/label").asText()).isEqualTo("멈춘 뒤 말한다");
        assertThat(analysis.at("/summary/uncertainties").toString()).contains("얼굴은 확인되지 않음");
    }

    @Test
    @DisplayName("practice.resume: 같은 묶음의 이전 대화·노트만 참고하고 제안을 실행 약속으로 바꾸지 않는다")
    void practiceResume_onlyEarlierRoundsOfTheSameGroupReachTheModel() throws Exception {
        UUID previous = analyzedPractice();
        closeWithNote(previous, "지난 회차에서 숨을 길게 쉬었어요", "호흡의 끝", "한 번 천천히 말해 보기");
        UUID unrelated = analyzedPractice();
        closeWithNote(unrelated, "다른 장면의 비밀", "무관한 노트", "무관한 제안");
        UUID current = analyzedPractice();
        jdbc.update("UPDATE practices SET root_id=?,ordinal=2 WHERE id=?", previous, current);
        // 숨긴 묶음에서도 이어하기는 된다. 숨김은 기록 목록의 표시만 바꾼다.
        jdbc.update("UPDATE practices SET hidden_at=now() WHERE id=?", previous);
        generator.enqueue(COACH_REPLY);

        startPractice(current);

        assertThat(generator.lastInput())
                .contains("지난 회차에서 숨을 길게 쉬었어요", "호흡의 끝", "제안: 한 번 천천히 말해 보기")
                .doesNotContain("다른 장면의 비밀", "무관한 노트", "무관한 제안", "해보기로 했지만 아직 안 해본 것");
    }

    @Test
    @DisplayName("practice.resume: 복수 대화 전환 후 옛 표에 남은 노트도 다음 회차의 참고 맥락에 남는다")
    void practiceResume_keepsAnOlderNoteWhenTheLatestMigratedConversationHasNone() throws Exception {
        UUID previous = fixtures.insertPractice(user).id();
        UUID summary = fixtures.insertSummary(previous);
        var stamp = CoachStorageFixtures.NOW.atOffset(java.time.ZoneOffset.UTC);
        UUID early = UUID.randomUUID();
        fixtures.insertCoachSession(early, previous, summary, "closed", stamp, List.of());
        UUID handoff = fixtures.insertHandoff(early, previous, stamp);
        jdbc.update("""
                INSERT INTO practice_reports(id,practice_session_id,report_type,report_json,source_handoff_id)
                VALUES (?,?,'analysis',CAST(? AS jsonb),?)
                """, UUID.randomUUID(), previous, REPORT_BODY, handoff);
        fixtures.insertCoachSession(UUID.randomUUID(), previous, summary, "closed", stamp.plusMinutes(1), List.of());
        migration.run(50);
        JsonNode visibleNote = successful(get("/v2/practices/{id}/note", previous).header("Authorization", bearer()));
        assertThat(visibleNote.at("/report/title").asText()).isEqualTo("생성된 리포트");
        UUID current = analyzedPractice();
        jdbc.update("UPDATE practices SET root_id=?,ordinal=2 WHERE id=?", previous, current);
        generator.enqueue(COACH_REPLY);

        startPractice(current);

        assertThat(generator.lastInput()).contains("생성된 리포트", "다음: 방향");
    }

    private void closeWithNote(UUID practice, String actorText, String title, String nextTake) {
        UUID conversation = insertConversation(practice, List.of("어떤 느낌이었나요", actorText));
        jdbc.update("UPDATE coach_conversations SET status='closed' WHERE id=?", conversation);
        jdbc.update("UPDATE practices SET stage='closed',close_reason='conversation_closed' WHERE id=?", practice);
        jdbc.update("""
                INSERT INTO coach_notes(id,conversation_id,format,kind,title,next_take,source_revision)
                VALUES (?,?,'v2','action',?,?,0)
                """, UUID.randomUUID(), conversation, title, nextTake);
    }

    private UUID analyzedPractice() {
        UUID video = UUID.randomUUID();
        UUID practice = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO videos(id,user_id,object_key,content_type,byte_size,duration_ms)
                VALUES (?,?,?,'video/mp4',1000,12000)
                """, video, user, "videos/" + video + ".mp4");
        jdbc.update("""
                INSERT INTO practices(id,user_id,video_id,root_id,ordinal,stage,experience_version,
                                      blockage_kind,sub_branch,situation)
                VALUES (?,?,?,?,1,'conversing','legacy','분석','캐릭터 분석','문 앞에서 돌아선다')
                """, practice, user, video, practice);
        jdbc.update("""
                INSERT INTO analyses(id,practice_id,format,status,model,record,completed_at)
                VALUES (?,?,'legacy','ready','test-model',CAST(? AS jsonb),now())
                """, UUID.randomUUID(), practice,
                "{\"scene_summary\":\"문 앞에서 돌아선다.\",\"observations\":" + OBSERVATIONS + ",\"uncertainties\":[]}");
        return practice;
    }

    private JsonNode startPractice(UUID practice) throws Exception {
        return successful(post("/v2/coach/start")
                .contentType(MediaType.APPLICATION_JSON).header("Authorization", bearer())
                .content(mapper.writeValueAsString(Map.of("practice_id", practice, "request_id", UUID.randomUUID()))));
    }

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

    private void rememberGoal() {
        jdbc.update("""
                INSERT INTO actor_memories(id,user_id,field,value,written_by)
                VALUES (?,?,'goal','입시 합격','actor')
                """, UUID.randomUUID(), user);
    }

    private UUID structuredPractice() {
        UUID practice = analyzedPractice();
        UUID analysis = jdbc.queryForObject("SELECT id FROM analyses WHERE practice_id=?", UUID.class, practice);
        jdbc.update("UPDATE practices SET experience_version='three_layers_v1' WHERE id=?", practice);
        var record = (com.fasterxml.jackson.databind.node.ObjectNode) StructuredJson.resource("/coaching/record.json");
        record.put("record_id", analysis.toString());
        jdbc.update("UPDATE analyses SET format='video_record_v1',record=CAST(? AS jsonb) WHERE practice_id=?", record.toString(), practice);
        return practice;
    }

    private UUID openLegacySession() {
        return insertConversation(analyzedPractice(), List.of("저장된 질문", "배우 말"));
    }

    private UUID insertConversation(UUID practice, List<String> messages) {
        UUID conversation = UUID.randomUUID();
        jdbc.update("INSERT INTO coach_conversations(id,practice_id,start_request_id,status) VALUES (?,?,?,'open')",
                conversation, practice, UUID.randomUUID());
        for (int i = 0; i < messages.size(); i++) {
            jdbc.update("INSERT INTO coach_messages(id,conversation_id,turn_index,role,text) VALUES (?,?,?,?,?)",
                    UUID.randomUUID(), conversation, i, i % 2 == 0 ? "ai" : "actor", messages.get(i));
        }
        return conversation;
    }

    private JsonNode reply(UUID sessionId, String contract) throws Exception {
        var request = post("/v2/coach/reply")
                .contentType(MediaType.APPLICATION_JSON)
                .header("Authorization", bearer())
                .content(mapper.writeValueAsString(Map.of("conversation_id", sessionId,
                        "request_id", UUID.randomUUID(), "text", "정리해줘")));
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
