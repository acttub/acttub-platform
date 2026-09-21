package com.acttub.actingapi.feature.memory;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import com.acttub.actingapi.feature.auth.app.JwtService;
import com.acttub.actingapi.feature.memory.app.ActorMemoryUpdateWorker;
import com.acttub.actingapi.integration.llm.GeneratedText;
import com.acttub.actingapi.integration.llm.TextGenerator;
import com.acttub.actingapi.integration.llm.TokenUsage;
import com.acttub.actingapi.support.AccountFixtures;
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
 * practice.memory 의 「검증 방법」 가운데 <b>서버</b> 항목을 HTTP 와 실제 Postgres 로 본다 —
 * {@code actor_memories} 네 칸, 갱신 예약(1·3·6·9…), 기억 세대다.
 *
 * <p>모델은 스텁이라 여기서 보는 것은 "무엇이 저장되고 무엇이 반영되지 않는가"다. 뽑는 규칙 자체는
 * {@code MemoryExtractorTest} 가 지킨다.
 */
@SpringBootTest(properties = {
    "JWT_SECRET=test-secret",
    "ACCOUNT_CLEANUP_ENABLED=false",
    "ACCOUNT_HOUSEKEEPING_ENABLED=false",
    "ANALYSIS_WORKER_ENABLED=false"
})
@AutoConfigureMockMvc
@Import(ActorMemoryIT.Fixture.class)
class ActorMemoryIT {
    private static final String CONTINUE = "{\"message\":\"무엇이 달라졌나요\",\"status\":\"continue\",\"handoff\":null}";
    private static final String CLOSING =
            "{\"message\":\"오늘은 여기까지 해요\",\"status\":\"complete\",\"handoff\":{\"end_reason\":\"user_ended\"}}";
    /** 기억 추출기가 낸 네 칸. 워커는 이것을 받아 저장한다. */
    private static final String EXTRACTED = """
            {"goal":"새 목표","blockage":"문 앞에서 멈춘다","speech_self":"또박또박 말한다",
             "speech_actual":"상대를 부른 뒤 부탁을 이어 간다"}
            """;

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        String name = PostgresContainerSupport.createDatabaseName("actor_memory");
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
    @Autowired
    ActorMemoryUpdateWorker worker;

    private UUID member;
    private String bearer;

    @BeforeEach
    void setUp() {
        jdbc.execute("TRUNCATE TABLE users RESTART IDENTITY CASCADE");
        generator.reset();
        member = member();
        bearer = "Bearer " + jwt.issueAccessToken(member).value();
    }

    @Test
    @DisplayName("practice.memory: 기존 갈래 확인 연습 1회 완료 — ai_jobs memory_update 1행이 생기고 워커가 끝나면 "
            + "actor_memories 에 written_by = agent 값이 남는다. 2회째는 갱신이 없고 3·6회째는 다시 갱신한다")
    void practiceMemory_updatesOnTheFirstPracticeAndEveryThirdAfterIt() throws Exception {
        closeConversation(analyzedPractice(member));
        assertThat(memoryJobs()).hasSize(1);

        assertThat(runWorker()).isTrue();
        assertThat(jdbc.queryForList("SELECT field,value,written_by FROM actor_memories WHERE user_id=?", member))
                .hasSize(4)
                .allSatisfy(row -> assertThat(row.get("written_by")).isEqualTo("agent"));

        closeConversation(analyzedPractice(member));
        assertThat(memoryJobs()).hasSize(1);

        closeConversation(analyzedPractice(member));
        assertThat(memoryJobs()).hasSize(2);

        closeConversation(analyzedPractice(member));
        closeConversation(analyzedPractice(member));
        assertThat(memoryJobs()).hasSize(2);
        closeConversation(analyzedPractice(member));
        assertThat(memoryJobs()).hasSize(3);
    }

    @Test
    @DisplayName("practice.memory: 확인 연습으로 세는 것은 노트가 남은 회차다 — action·observation 은 세고 "
            + "record_only 는 세지 않는다")
    void practiceMemory_onlyActionAndObservationNotesCountAsConfirmedPractices() throws Exception {
        // record_only 를 세었다면 이번 종료가 2회째라 예약이 없다.
        seedNote(analyzedPractice(member), "v2", "record_only");
        closeConversation(analyzedPractice(member));
        assertThat(memoryJobs()).hasSize(1);

        // action 을 세지 않았다면 이번 종료가 1회째라 예약이 생긴다.
        useNewMember();
        seedNote(analyzedPractice(member), "v2", "action");
        closeConversation(analyzedPractice(member));
        assertThat(memoryJobs()).isEmpty();

        useNewMember();
        seedNote(analyzedPractice(member), "v2", "observation");
        closeConversation(analyzedPractice(member));
        assertThat(memoryJobs()).isEmpty();
    }

    @Test
    @DisplayName("practice.memory: 배우가 goal 을 적으면 written_by 가 actor 이고, 그 뒤 워커가 끝나도 그 칸은 그대로다. "
            + "1,000자는 200 이고 1,001자는 422 다")
    void practiceMemory_actorWrittenFieldsSurviveTheWorker() throws Exception {
        JsonNode written = json(put("/v2/me/memory/goal").content("{\"value\":\"내가 적은 목표\"}"), 200);
        assertThat(written.path("written_by_actor").booleanValue()).isTrue();
        assertThat(written.path("source_practice_id").isNull()).isTrue();

        closeConversation(analyzedPractice(member));
        assertThat(runWorker()).isTrue();

        assertThat(value("goal")).isEqualTo("내가 적은 목표");
        assertThat(writtenBy("goal")).isEqualTo("actor");
        assertThat(writtenBy("blockage")).isEqualTo("agent");

        perform(put("/v2/me/memory/goal").content(valueBody("가".repeat(1000))), 200);
        perform(put("/v2/me/memory/goal").content(valueBody("가".repeat(1001))), 422);
    }

    @Test
    @DisplayName("practice.memory: 전체 삭제는 기억 세대를 올린다 — 삭제 전에 예약돼 진행 중이던 갱신이 끝나도 행이 "
            + "생기지 않는다. 그 뒤 누적이 다시 3의 배수가 되면 갱신한다")
    void practiceMemory_deletingAllDropsUpdatesScheduledBeforeIt() throws Exception {
        closeConversation(analyzedPractice(member));
        perform(delete("/v2/me/memory"), 204);

        assertThat(runWorker()).isTrue();
        assertThat(rows()).isEmpty();
        assertThat(jdbc.queryForObject(
                "SELECT failure_reason FROM ai_jobs WHERE kind='memory_update' AND user_id=?",
                String.class, member))
                .isEqualTo("memory_epoch_stale");

        closeConversation(analyzedPractice(member));
        assertThat(memoryJobs()).as("삭제가 누적 횟수를 초기화하지 않는다 — 2회째라 예약이 늘지 않는다").hasSize(1);
        closeConversation(analyzedPractice(member));
        assertThat(memoryJobs()).hasSize(2);
        assertThat(runWorker()).isTrue();
        assertThat(rows()).hasSize(4);
    }

    @Test
    @DisplayName("practice.memory: 기억 갱신이 실패하면 작업이 대기로 돌아가고 시도 횟수는 그대로 쌓인다 — "
            + "재시도 규칙이 분석과 같다. 회차 상태는 건드리지 않는다")
    void practiceMemory_failedUpdatesGoBackToTheQueue() throws Exception {
        UUID practice = analyzedPractice(member);
        closeConversation(practice);

        // 모델이 답하지 않는다(스텁의 큐가 비어 있다).
        assertThat(worker.runOnce()).isTrue();

        assertThat(jdbc.queryForMap(
                "SELECT status,attempt_count,lease_token,failure_reason FROM ai_jobs WHERE kind='memory_update'"))
                .containsEntry("status", "pending")
                .containsEntry("attempt_count", 1)
                .containsEntry("lease_token", null)
                .containsEntry("failure_reason", "memory_update_failed");
        assertThat(jdbc.queryForObject("SELECT stage FROM practices WHERE id=?", String.class, practice))
                .as("기억 갱신 실패가 회차를 닫지 않는다").isNotEqualTo("closed");
        assertThat(rows()).isEmpty();

        assertThat(runWorker()).isTrue();
        assertThat(rows()).hasSize(4);
    }

    @Test
    @DisplayName("practice.memory: 항목 하나 삭제는 그 칸만 지우고 두 번 삭제해도 204 다. 출처 회차를 숨기면 값은 "
            + "그대로고 출처 링크만 사라진다")
    void practiceMemory_deletingOneFieldIsIdempotentAndHiddenSourcesLoseTheirLink() throws Exception {
        UUID practice = analyzedPractice(member);
        closeConversation(practice);
        assertThat(runWorker()).isTrue();

        JsonNode before = json(get("/v2/me/memory"), 200);
        assertThat(item(before, "goal").path("source_practice_id").textValue()).isEqualTo(practice.toString());

        jdbc.update("UPDATE practices SET hidden_at=now() WHERE id=?", practice);
        JsonNode hidden = json(get("/v2/me/memory"), 200);
        assertThat(item(hidden, "goal").path("value").textValue())
                .isEqualTo(item(before, "goal").path("value").textValue());
        assertThat(item(hidden, "goal").path("source_practice_id").isNull()).isTrue();

        perform(delete("/v2/me/memory/goal"), 204);
        perform(delete("/v2/me/memory/goal"), 204);
        assertThat(rows()).hasSize(3);
        assertThat(rows().stream().map(row -> row.get("field"))).doesNotContain("goal");
    }

    // --- 도우미 -------------------------------------------------------------

    private boolean runWorker() {
        generator.enqueue(EXTRACTED);
        return worker.runOnce();
    }

    private List<Map<String, Object>> memoryJobs() {
        return jdbc.queryForList(
                "SELECT id,memory_epoch,status FROM ai_jobs WHERE kind='memory_update' AND user_id=?", member);
    }

    /** 확인 연습의 누적은 계정마다 센다 — 갈래를 가르려면 매번 깨끗한 계정이 필요하다. */
    private void useNewMember() {
        member = member();
        bearer = "Bearer " + jwt.issueAccessToken(member).value();
    }

    private List<Map<String, Object>> rows() {
        return jdbc.queryForList("SELECT field,value,written_by FROM actor_memories WHERE user_id=?", member);
    }

    private String value(String field) {
        return jdbc.queryForObject(
                "SELECT value FROM actor_memories WHERE user_id=? AND field=?", String.class, member, field);
    }

    private String writtenBy(String field) {
        return jdbc.queryForObject(
                "SELECT written_by FROM actor_memories WHERE user_id=? AND field=?", String.class, member, field);
    }

    /** 유효한 배우 답 둘 뒤에 종료한다 — 기존 갈래가 노트를 만드는 최소 조건이다(practice.note). */
    private void closeConversation(UUID practiceId) throws Exception {
        generator.enqueue(CONTINUE);
        UUID conversation = UUID.fromString(json(
                post("/v2/coach/start").content(
                        "{\"practice_id\":\"%s\",\"request_id\":\"%s\"}".formatted(practiceId, UUID.randomUUID())),
                200).path("conversation").path("id").textValue());
        generator.enqueue(CONTINUE);
        json(post("/v2/coach/reply").content(replyBody(conversation, "첫 답")), 200);
        generator.enqueue(CLOSING);
        json(post("/v2/coach/reply").content(replyBody(conversation, "둘째 답")), 200);
    }

    private String replyBody(UUID conversation, String text) {
        return "{\"conversation_id\":\"%s\",\"request_id\":\"%s\",\"text\":\"%s\"}"
                .formatted(conversation, UUID.randomUUID(), text);
    }

    private static String valueBody(String value) {
        return "{\"value\":\"" + value + "\"}";
    }

    /** 대화를 돌리지 않고 노트만 심는다 — 세는 규칙이 노트의 종류만 본다는 것을 그대로 본다. */
    private void seedNote(UUID practiceId, String format, String kind) {
        UUID conversation = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO coach_conversations(id,practice_id,start_request_id,status,close_reason,closed_at)
                VALUES (?,?,?, 'closed','user_ended',now())
                """, conversation, practiceId, UUID.randomUUID());
        jdbc.update("""
                INSERT INTO coach_notes(id,conversation_id,format,kind,source_revision)
                VALUES (?,?,?,?,1)
                """, UUID.randomUUID(), conversation, format, kind);
        jdbc.update("UPDATE practices SET stage='closed',close_reason='conversation_closed' WHERE id=?", practiceId);
    }

    private UUID member() {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO users(id,status) VALUES (?,'active')", id);
        jdbc.update("INSERT INTO user_identities(id,user_id,provider,provider_uid) VALUES (?,?,'google',?)",
                UUID.randomUUID(), id, "g-" + id);
        AccountFixtures.passGate(jdbc, id);
        return id;
    }

    private UUID analyzedPractice(UUID owner) {
        UUID videoId = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO videos(id,user_id,object_key,content_type,byte_size,duration_ms)
                VALUES (?,?,?,'video/mp4',1000,12000)
                """, videoId, owner, "videos/" + owner + "/" + videoId + ".mp4");
        UUID id = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO practices(id,user_id,video_id,root_id,ordinal,stage,experience_version,
                                      blockage_kind,sub_branch,situation,goal)
                VALUES (?,?,?,?,1,'conversing','legacy','표현','감정','문 앞에서 돌아선다','망설임을 보여 주기')
                """, id, owner, videoId, id);
        jdbc.update("""
                INSERT INTO analyses(id,practice_id,format,status,model,record,completed_at)
                VALUES (?,?,'legacy','ready','test-model',CAST(? AS jsonb),now())
                """, UUID.randomUUID(), id,
                "{\"scene_summary\":\"문 앞에서 돌아선다\",\"observations\":[],\"uncertainties\":[]}");
        return id;
    }

    private static JsonNode item(JsonNode response, String field) {
        for (JsonNode item : response.path("items")) {
            if (field.equals(item.path("field").textValue())) {
                return item;
            }
        }
        throw new AssertionError("no memory item for " + field);
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
        assertThat(response.getStatus()).isEqualTo(status);
        return response;
    }

    @TestConfiguration
    static class Fixture {
        @Bean
        @Primary
        StubGenerator stubGenerator() {
            return new StubGenerator();
        }
    }

    /** 모델 포트의 스텁. 시험이 미리 넣어 둔 응답을 차례로 낸다. */
    static final class StubGenerator implements TextGenerator {
        private final Deque<String> responses = new ArrayDeque<>();
        private final List<String> inputs = new ArrayList<>();

        @Override
        public synchronized GeneratedText generate(String systemInstructions, String input) {
            inputs.add(input);
            if (responses.isEmpty()) {
                throw new IllegalStateException("unexpected LLM call #" + inputs.size());
            }
            return new GeneratedText(responses.removeFirst(), new TokenUsage(0, 0, 0));
        }

        synchronized void enqueue(String response) {
            responses.addLast(response);
        }

        synchronized int pending() {
            return responses.size();
        }

        synchronized void reset() {
            responses.clear();
            inputs.clear();
        }
    }
}
