package com.acttub.actingapi.feature.coach;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;

import java.time.Clock;
import java.time.Instant;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;

import com.acttub.actingapi.feature.auth.app.JwtService;
import com.acttub.actingapi.feature.coach.app.ConversationRepository;
import com.acttub.actingapi.feature.coach.app.JournalRepository;
import com.acttub.actingapi.feature.coach.app.JournalService;
import com.acttub.actingapi.feature.profile.app.ProfileService;
import com.acttub.actingapi.feature.push.app.PracticeReminderRepository;
import com.acttub.actingapi.integration.llm.GeneratedText;
import com.acttub.actingapi.platform.observability.LlmTelemetry;
import com.acttub.actingapi.support.AccountFixtures;
import com.acttub.actingapi.support.MutableClock;
import com.acttub.actingapi.support.PostgresContainerSupport;
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
 * practice.journal 배우 일지 — HTTP 와 실제 Postgres 로 만들기·읽기·고치기·소유권·탈퇴·코칭 숙제 알림을 본다. 모델은 정해 둔 답을 낸다.
 */
@SpringBootTest(properties = {
    "JWT_SECRET=test-secret",
    "ACCOUNT_CLEANUP_ENABLED=false",
    "ACCOUNT_HOUSEKEEPING_ENABLED=false",
    "ANALYSIS_WORKER_ENABLED=false",
    "EXIT_SURVEY_SYNC_ENABLED=false"
})
@AutoConfigureMockMvc
@Import(JournalIT.Fixture.class)
class JournalIT {

    /** 모델 답. null 이면 실패한다. */
    static final AtomicReference<String> MODEL = new AtomicReference<>();

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        String name = PostgresContainerSupport.createDatabaseName("actor_journal");
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
    ProfileService accounts;
    @Autowired
    PracticeReminderRepository reminders;

    private UUID member;
    private String bearer;
    private UUID practice;

    private static final String ANSWERS = """
            {"answers":{"feeling":{"choice":"떨렸어요","text":" 낮게 하니까 오히려 더 떨렸어요 "},
             "unknown":{"none":false,"text":"앞 대사가 화난 건지 모르겠어요"},
             "next":{"undecided":false,"text":"앞 대사부터 상대를 보며 말하기"},
             "review":"소리 안 질러도 붙잡을 수 있었다"}}""";

    @BeforeEach
    void setUp() {
        jdbc.execute("TRUNCATE TABLE users RESTART IDENTITY CASCADE");
        MODEL.set("""
                {"schema_version":"acttub.actor_journal_draft.v4",
                 "practice":[{"text":"상대 눈을 보며 낮게 말해 봤어요","basis":"actor_report","source_refs":["m0"]}],
                 "character":[{"aspect":"partner","text":"연인","source_refs":["c0"]}],
                 "feedback":[{"text":"앞 대사부터 붙잡듯 말해 봐도 좋아요","giver":"coach","moment_ref":null,"source_refs":["c1"]}]}""");
        member = member();
        bearer = bearer(member);
        practice = practice(member);
        conversation(practice);
    }

    @Test
    @DisplayName("practice.journal: 답 4개로 만들면 201 — 배우 답은 그대로, 근거 없는 AI 칸은 빈 칸. 두 번째는 다시 만들지 않고 200")
    void create_keepsAnswersAndDropsGroundlessDraft() throws Exception {
        JsonNode made = json(post("/v2/practices/{id}/journal", practice).content(ANSWERS), 201);

        assertThat(made.path("draft_status").asText()).isEqualTo("ready");
        assertThat(made.path("answers").path("feeling").path("text").asText()).isEqualTo("낮게 하니까 오히려 더 떨렸어요");
        assertThat(made.path("answers").path("next").path("text").asText()).isEqualTo("앞 대사부터 상대를 보며 말하기");
        assertThat(made.path("practice")).hasSize(1);
        assertThat(made.path("character")).isEmpty();
        assertThat(made.path("feedback").get(0).path("at").isNull()).isTrue();
        assertThat(made.path("purpose").isNull()).isTrue();
        assertThat(made.path("title").asText()).isEqualTo("카페 이별");

        MODEL.set(null);
        JsonNode again = json(post("/v2/practices/{id}/journal", practice).content("{\"answers\":{}}"), 200);
        assertThat(again.path("id").asText()).isEqualTo(made.path("id").asText());
        assertThat(json(get("/v2/practices/{id}/journal", practice), 200).path("answers").path("review").asText())
                .isEqualTo("소리 안 질러도 붙잡을 수 있었다");
        assertThat(jdbc.queryForObject("SELECT count(*) FROM actor_journals", Integer.class)).isEqualTo(1);
    }

    @Test
    @DisplayName("practice.journal: 모델이 두 번 실패하면 배우 답만으로 저장한다(failed)")
    void create_failedModelKeepsAnswers() throws Exception {
        MODEL.set(null);
        JsonNode made = json(post("/v2/practices/{id}/journal", practice).content(ANSWERS), 201);
        assertThat(made.path("draft_status").asText()).isEqualTo("failed");
        assertThat(made.path("practice")).isEmpty();
        assertThat(made.path("answers").path("review").asText()).isEqualTo("소리 안 질러도 붙잡을 수 있었다");
    }

    @Test
    @DisplayName("practice.journal: 고치면 배우 답·줄을 바꾸고 edited_at 을 찍는다. 빈 줄은 지운다")
    void update_replacesAndStampsEdit() throws Exception {
        perform(post("/v2/practices/{id}/journal", practice).content(ANSWERS), 201);
        JsonNode edited = json(put("/v2/practices/{id}/journal", practice).content("""
                {"answers":{"feeling":null,"unknown":{"none":true,"text":null},"next":{"undecided":false,"text":"고친 다음"},
                 "review":"고친 후기"},
                 "practice":[{"text":"고친 연습","basis":"discussed"},{"text":"  ","basis":null}],
                 "character":[{"aspect":"wants","text":"붙잡기"}],
                 "feedback":[{"text":"고친 피드백","giver":"coach","at":31}]}"""), 200);

        assertThat(edited.path("answers").path("review").asText()).isEqualTo("고친 후기");
        assertThat(edited.path("answers").path("feeling").isNull()).isTrue();
        assertThat(edited.path("practice")).hasSize(1);
        assertThat(edited.path("feedback").get(0).path("at").asInt()).isEqualTo(31);
        assertThat(edited.path("edited_at").isNull()).isFalse();
    }

    @Test
    @DisplayName("practice.journal: 남의 것·없는 것은 404 — 만들기는 practice_not_found, 읽기·고치기는 journal_not_found. 본문이 틀리면 422")
    void ownershipAndValidation() throws Exception {
        UUID stranger = member();
        UUID theirs = practice(stranger);
        assertThat(json(post("/v2/practices/{id}/journal", theirs).content(ANSWERS), 404).path("detail").asText())
                .isEqualTo("practice_not_found");
        assertThat(json(get("/v2/practices/{id}/journal", practice), 404).path("detail").asText())
                .isEqualTo("journal_not_found");
        assertThat(json(put("/v2/practices/{id}/journal", practice).content(
                "{\"answers\":{},\"practice\":[],\"character\":[],\"feedback\":[]}"), 404).path("detail").asText())
                .isEqualTo("journal_not_found");
        perform(post("/v2/practices/{id}/journal", practice).content("{\"answers\":{\"review\":\"%s\"}}".formatted("가".repeat(301))), 422);
        perform(post("/v2/practices/{id}/journal", practice).content("{\"answers\":{},\"extra\":1}"), 422);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM actor_journals", Integer.class)).isZero();
    }

    @Test
    @DisplayName("코칭 숙제 알림은 일지의 「다음에 해 볼 것」을 노트 제안보다 먼저 쓴다. 탈퇴하면 일지는 지운다")
    void homeworkPrefersJournalAndWithdrawalErases() throws Exception {
        assertThat(reminders.latestHomework(member).nextTake()).isEqualTo("대사가 끝나도 시선을 두고 찍어보세요");
        perform(post("/v2/practices/{id}/journal", practice).content(ANSWERS), 201);
        assertThat(reminders.latestHomework(member).nextTake()).isEqualTo("앞 대사부터 상대를 보며 말하기");

        accounts.withdraw(member);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM actor_journals", Integer.class)).isZero();
    }

    // --- 도우미 -------------------------------------------------------------

    private String bearer(UUID userId) {
        return "Bearer " + jwt.issueAccessToken(userId).value();
    }

    private UUID member() {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO users(id,status) VALUES (?,'active')", id);
        jdbc.update("INSERT INTO user_identities(id,user_id,provider,provider_uid) VALUES (?,?,'google',?)",
                UUID.randomUUID(), id, "g-" + id);
        AccountFixtures.passGate(jdbc, id);
        return id;
    }

    private UUID practice(UUID owner) {
        UUID videoId = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO videos(id,user_id,object_key,content_type,byte_size,duration_ms)
                VALUES (?,?,?,'video/mp4',1000,12000)
                """, videoId, owner, "videos/" + owner + "/" + videoId + ".mp4");
        UUID id = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO practices(id,user_id,video_id,root_id,ordinal,stage,experience_version,
                                      blockage_kind,sub_branch,situation,title)
                VALUES (?,?,?,?,1,'closed','three_layers_v1','표현','감정','문 앞에서 돌아선다','카페 이별')
                """, id, owner, videoId, id);
        return id;
    }

    /** 닫힌 대화(코치 질문·배우 답·코치 제안)와 그 노트. */
    private void conversation(UUID practiceId) {
        UUID conversation = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO coach_conversations(id,practice_id,start_request_id,status,close_reason,closed_at)
                VALUES (?,?,?,'closed','user_ended',now())
                """, conversation, practiceId, UUID.randomUUID());
        String[][] turns = {{"ai", "상대한테서 뭘 얻고 싶었어요?"}, {"actor", "상대 눈을 보면서 낮게 말해 봤어요."},
            {"ai", "앞 대사부터 붙잡듯 말해 봐도 좋아요."}};
        for (int i = 0; i < turns.length; i++) {
            jdbc.update("INSERT INTO coach_messages(id,conversation_id,turn_index,role,text) VALUES (?,?,?,?,?)",
                    UUID.randomUUID(), conversation, i, turns[i][0], turns[i][1]);
        }
        jdbc.update("""
                INSERT INTO coach_notes(id,conversation_id,format,kind,title,next_take,source_revision)
                VALUES (?,?,'v2','action','기다리는 시선','대사가 끝나도 시선을 두고 찍어보세요',3)
                """, UUID.randomUUID(), conversation);
    }

    private JsonNode json(MockHttpServletRequestBuilder request, int status) throws Exception {
        return mapper.readTree(perform(request, status).getContentAsString());
    }

    private MockHttpServletResponse perform(MockHttpServletRequestBuilder request, int status) throws Exception {
        MockHttpServletResponse response = mvc.perform(request
                        .header("Authorization", bearer)
                        .contentType(MediaType.APPLICATION_JSON))
                .andReturn()
                .getResponse();
        assertThat(response.getStatus()).as(response.getContentAsString()).isEqualTo(status);
        return response;
    }

    @TestConfiguration
    static class Fixture {
        @Bean
        @Primary
        MutableClock mutableClock() {
            return new MutableClock(Instant.parse("2026-10-23T00:00:00Z"));
        }

        /** 모델만 정해 둔 답으로 바꾼다. 저장소·대화 읽기는 실제 것이다. */
        @Bean
        @Primary
        JournalService fixedModelJournalService(JournalRepository journals, ConversationRepository conversations,
                LlmTelemetry telemetry, ObjectMapper json, Clock clock) {
            return new JournalService(journals, conversations, (system, input) -> {
                String reply = MODEL.get();
                if (reply == null) throw new IllegalStateException("model down");
                return new GeneratedText(reply, null, "fixed");
            }, telemetry, json, clock, UUID::randomUUID);
        }
    }
}
