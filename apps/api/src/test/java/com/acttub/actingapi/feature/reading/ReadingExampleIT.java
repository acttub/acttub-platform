package com.acttub.actingapi.feature.reading;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicInteger;

import com.acttub.actingapi.feature.auth.app.JwtService;
import com.acttub.actingapi.feature.reading.domain.SampleScript;
import com.acttub.actingapi.integration.llm.GeneratedText;
import com.acttub.actingapi.integration.llm.GenerationOptions;
import com.acttub.actingapi.integration.llm.TextGenerator;
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
 * reading.script 「예시 대본」의 서버 목록과 복사(V61 {@code reading_examples})를 HTTP·실제 Postgres 로 본다. 모델은 부르면 기록만
 * 하는 가짜다 — 이 길은 모델을 부르지 않아야 한다.
 */
@SpringBootTest(properties = {
    "JWT_SECRET=test-secret",
    "ANALYSIS_WORKER_ENABLED=false",
    "ACCOUNT_CLEANUP_ENABLED=false",
    "ACCOUNT_HOUSEKEEPING_ENABLED=false",
    "CHALLENGE_SETTLEMENT_ENABLED=false"
})
@AutoConfigureMockMvc
@Import({MutableClock.Fixture.class, ReadingExampleIT.Model.class})
class ReadingExampleIT {
    private static final OffsetDateTime PUBLISHED = OffsetDateTime.of(2026, 10, 1, 0, 0, 0, 0, ZoneOffset.UTC);
    private static final AtomicInteger ADDRESSES = new AtomicInteger();

    @TestConfiguration
    static class Model {
        static final List<String> CALLS = new CopyOnWriteArrayList<>();

        @Bean @Primary TextGenerator recordingTextGenerator() {
            return new TextGenerator() {
                @Override public GeneratedText generate(String instructions, String input) {
                    return generate(instructions, input, null);
                }

                @Override public GeneratedText generate(String instructions, String input, GenerationOptions options) {
                    CALLS.add(input);
                    throw new IllegalStateException("예시 대본 복사는 모델을 부르지 않는다");
                }
            };
        }
    }

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        String name = PostgresContainerSupport.createDatabaseName("reading_example");
        registry.add("spring.datasource.url", () -> PostgresContainerSupport.jdbcUrlFor(name));
        registry.add("spring.datasource.username", PostgresContainerSupport.POSTGRES::getUsername);
        registry.add("spring.datasource.password", PostgresContainerSupport.POSTGRES::getPassword);
    }

    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate jdbc;
    @Autowired ObjectMapper mapper;
    @Autowired JwtService jwt;

    private final Map<String, UUID> documents = new LinkedHashMap<>();
    private UUID member;
    private String bearer;

    @BeforeEach
    void setUp() {
        Model.CALLS.clear();
        jdbc.execute("TRUNCATE TABLE users,consent_documents,ai_jobs RESTART IDENTITY CASCADE");
        jdbc.update("UPDATE reading_examples SET active=true");
        documents.clear();
        // script_split 문서는 발행돼 있지만 회원은 동의하지 않는다(아래 member()) — 이 길은 동의를 묻지 않는다.
        for (String type : List.of("terms", "privacy", "ai_analysis", "script_split")) {
            UUID id = UUID.randomUUID();
            documents.put(type, id);
            jdbc.update("""
                    INSERT INTO consent_documents(id,type,version,locale,title,body,required,published_at)
                    VALUES (?,?,'v1','ko',?,?,?,?)
                    """, id, type, type + " 제목", type + " 본문", !"script_split".equals(type), PUBLISHED);
        }
        member = member();
        bearer = "Bearer " + jwt.issueAccessToken(member).value();
    }

    @Test
    @DisplayName("예시 대본 목록: 켜진 3편을 sort_order 순으로 — 대사 수·배역·미리보기 5줄(지문은 speaker null)")
    void listsActiveExamplesInOrder() throws Exception {
        JsonNode body = json(get("/v2/reading/examples"), 200, bearer);
        JsonNode examples = body.path("examples");
        assertThat(examples).extracting(e -> e.path("id").textValue()).containsExactly("rooftop", "cafe", "minji");
        assertThat(examples).extracting(e -> e.path("title").textValue())
                .containsExactly("옥상, 밤", "카페, 헤어지자는 말", "민지의 독백");
        assertThat(examples).extracting(e -> e.path("summary").textValue())
                .containsExactly("윤서 · 태오 · 2인 대화", "서연 · 준호 · 2인 대화", "혼자 읽는 독백");
        assertThat(examples).extracting(e -> e.path("dialogue_count").intValue()).containsExactly(15, 15, 7);
        assertThat(examples.get(1).path("characters")).extracting(JsonNode::textValue).containsExactly("서연", "준호");
        assertThat(examples.get(2).path("characters")).extracting(JsonNode::textValue).containsExactly("민지");

        JsonNode preview = examples.get(0).path("preview");
        assertThat(preview).hasSize(5);
        assertThat(preview.get(0).path("speaker").isNull()).isTrue();
        assertThat(preview.get(0).path("text").textValue()).isEqualTo("(옥상 난간. 도시 불빛. 바람 소리.)");
        assertThat(preview.get(1).path("speaker").textValue()).isEqualTo("윤서");
        assertThat(preview.get(1).path("text").textValue()).isEqualTo("여기 있을 줄 알았어.");
        assertThat(preview.get(2).path("speaker").textValue()).isEqualTo("태오");
        assertThat(examples.get(0).fieldNames()).toIterable()
                .containsExactlyInAnyOrder("id", "title", "summary", "dialogue_count", "characters", "preview");

        jdbc.update("UPDATE reading_examples SET active=false WHERE id='cafe'");
        assertThat(json(get("/v2/reading/examples"), 200, bearer).path("examples"))
                .extracting(e -> e.path("id").textValue()).containsExactly("rooftop", "minji");
    }

    @Test
    @DisplayName("예시 시작: 201 새 대본(source sample·예시 제목·미리 나눈 줄), 다시 고르면 200 같은 대본, 지운 뒤면 201 새 대본 — 모델·작업 행 0")
    void startsCopiesOnceAndAgainAfterDelete() throws Exception {
        JsonNode first = json(post("/v2/reading/examples/{id}/start", "cafe").content(start(UUID.randomUUID())), 201, bearer);
        assertThat(first.path("created").booleanValue()).isTrue();
        String scriptId = first.path("script_id").textValue();
        assertThat(first.fieldNames()).toIterable().containsExactlyInAnyOrder("script_id", "created");

        JsonNode script = json(get("/v2/reading/scripts/{id}", scriptId), 200, bearer);
        assertThat(script.path("title").textValue()).isEqualTo("카페, 헤어지자는 말");
        assertThat(script.path("source").textValue()).isEqualTo("sample");
        assertThat(script.path("characters")).extracting(c -> c.path("name").textValue()).containsExactly("서연", "준호");
        assertThat(script.path("lines")).hasSize(17);
        assertThat(script.path("lines").get(1).path("text").textValue()).isEqualTo("일찍 왔네.");

        JsonNode again = json(post("/v2/reading/examples/{id}/start", "cafe").content(start(UUID.randomUUID())), 200, bearer);
        assertThat(again.path("created").booleanValue()).isFalse();
        assertThat(again.path("script_id").textValue()).isEqualTo(scriptId);
        assertThat(count("scripts")).isEqualTo(1);

        json(delete("/v2/reading/scripts/{id}", scriptId), 204, bearer);
        JsonNode copied = json(post("/v2/reading/examples/{id}/start", "cafe").content(start(UUID.randomUUID())), 201, bearer);
        assertThat(copied.path("created").booleanValue()).isTrue();
        assertThat(copied.path("script_id").textValue()).isNotEqualTo(scriptId);
        assertThat(count("scripts")).isEqualTo(1);

        assertThat(Model.CALLS).isEmpty();
        assertThat(count("ai_jobs")).isZero();
        assertThat(count("script_imports")).isZero();
    }

    @Test
    @DisplayName("예시 시작: 옛 길(글 올리기)로 넣은 「옥상, 밤」이 있으면 그 대본을 200 으로 준다 — 같은 글이다")
    void reusesTheSameTextFromTheOldPath() throws Exception {
        JsonNode rooftop = json(post("/v2/reading/examples/{id}/start", "rooftop").content(start(UUID.randomUUID())), 201, bearer);
        assertThat(jdbc.queryForObject("SELECT raw_hash FROM scripts", String.class))
                .as("옛 길의 예시 판별과 같은 글").isEqualTo(SampleScript.HASH);
        JsonNode script = json(get("/v2/reading/scripts/{id}", rooftop.path("script_id").textValue()), 200, bearer);
        assertThat(script.path("lines")).hasSize(17);

        JsonNode minji = json(post("/v2/reading/examples/{id}/start", "minji").content(start(UUID.randomUUID())), 201, bearer);
        JsonNode monologue = json(get("/v2/reading/scripts/{id}", minji.path("script_id").textValue()), 200, bearer);
        assertThat(monologue.path("characters")).extracting(c -> c.path("name").textValue()).containsExactly("민지");
        assertThat(monologue.path("lines")).hasSize(8);
    }

    @Test
    @DisplayName("예시 시작: 같은 request_id 재전송은 200 같은 대본")
    void replaysTheSameRequestId() throws Exception {
        UUID requestId = UUID.randomUUID();
        String first = json(post("/v2/reading/examples/{id}/start", "minji").content(start(requestId)), 201, bearer)
                .path("script_id").textValue();
        JsonNode replay = json(post("/v2/reading/examples/{id}/start", "minji").content(start(requestId)), 200, bearer);
        assertThat(replay.path("script_id").textValue()).isEqualTo(first);
        assertThat(replay.path("created").booleanValue()).isFalse();
        assertThat(count("scripts")).isEqualTo(1);
    }

    @Test
    @DisplayName("예시 시작: 게스트도 된다(script_split 을 결정할 수 없어도)")
    void guestsCanStart() throws Exception {
        String guest = consentedGuest();
        JsonNode started = json(post("/v2/reading/examples/{id}/start", "cafe").content(start(UUID.randomUUID())), 201, guest);
        assertThat(started.path("created").booleanValue()).isTrue();
        assertThat(json(get("/v2/reading/examples"), 200, guest).path("examples")).hasSize(3);
        assertThat(Model.CALLS).isEmpty();
    }

    @Test
    @DisplayName("예시 시작: 대본 수 한도는 그대로 — 회원 100개면 422 script_limit, 이미 복사한 예시는 한도여도 200")
    void scriptLimitStillApplies() throws Exception {
        String cafe = json(post("/v2/reading/examples/{id}/start", "cafe").content(start(UUID.randomUUID())), 201, bearer)
                .path("script_id").textValue();
        seedScripts(member, 99);
        assertThat(json(post("/v2/reading/examples/{id}/start", "minji").content(start(UUID.randomUUID())), 422, bearer))
                .isEqualTo(mapper.readTree("{\"detail\":\"script_limit\"}"));
        assertThat(json(post("/v2/reading/examples/{id}/start", "cafe").content(start(UUID.randomUUID())), 200, bearer)
                .path("script_id").textValue()).isEqualTo(cafe);
        assertThat(count("scripts")).isEqualTo(100);
    }

    @Test
    @DisplayName("예시 시작: 없는·꺼진 예시는 404 reading_example_not_found, request_id 가 없으면 422, 탈퇴한 계정은 403 account_deactivated")
    void rejects() throws Exception {
        assertThat(json(post("/v2/reading/examples/{id}/start", "nope").content(start(UUID.randomUUID())), 404, bearer))
                .isEqualTo(mapper.readTree("{\"detail\":\"reading_example_not_found\"}"));
        jdbc.update("UPDATE reading_examples SET active=false WHERE id='cafe'");
        assertThat(json(post("/v2/reading/examples/{id}/start", "cafe").content(start(UUID.randomUUID())), 404, bearer))
                .isEqualTo(mapper.readTree("{\"detail\":\"reading_example_not_found\"}"));
        json(post("/v2/reading/examples/{id}/start", "minji").content("{}"), 422, bearer);
        assertThat(count("scripts")).isZero();

        jdbc.update("UPDATE users SET status='deactivated' WHERE id=?", member);
        assertThat(json(post("/v2/reading/examples/{id}/start", "minji").content(start(UUID.randomUUID())), 403, bearer)
                .path("detail").textValue()).isEqualTo("account_deactivated");
        assertThat(count("scripts")).isZero();
    }

    private String start(UUID requestId) {
        return "{\"request_id\":\"" + requestId + "\"}";
    }

    private void seedScripts(UUID owner, int howMany) {
        for (int index = 0; index < howMany; index++) {
            jdbc.update("""
                    INSERT INTO scripts(id,user_id,title,raw_text,raw_hash,source,request_id,request_fingerprint)
                    VALUES (?,?,?,'원문',repeat('0',64),'paste',?,?)
                    """, UUID.randomUUID(), owner, "대본 " + index, UUID.randomUUID(), "f".repeat(64));
        }
    }

    /** 가입을 끝냈지만 script_split 에는 동의하지 않은 회원. */
    private UUID member() {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO users(id,status) VALUES (?,'active')", id);
        jdbc.update("INSERT INTO user_identities(id,user_id,provider,provider_uid) VALUES (?,?,'google',?)", UUID.randomUUID(), id, "g-" + id);
        AccountFixtures.passGate(jdbc, id);
        jdbc.update("DELETE FROM user_consents WHERE user_id=? AND document_id=?", id, documents.get("script_split"));
        return id;
    }

    /** 리딩의 문서 둘에 동의한 웹 게스트의 토큰. */
    private String consentedGuest() throws Exception {
        var created = mvc.perform(post("/v2/auth/guest").with(request -> {
            request.setRemoteAddr("10.49." + ADDRESSES.incrementAndGet() + ".1");
            return request;
        })).andReturn().getResponse();
        assertThat(created.getStatus()).isEqualTo(201);
        String guest = "Bearer " + mapper.readTree(created.getContentAsString()).path("access_token").textValue();
        boolean first = true;
        for (String type : List.of("terms", "privacy")) {
            Map<String, Object> consent = new LinkedHashMap<>();
            consent.put("document_id", documents.get(type).toString());
            consent.put("action", "granted");
            if (first) consent.put("age_confirmed", true);
            first = false;
            var response = perform(post("/v2/consents").contentType(MediaType.APPLICATION_JSON)
                    .content(mapper.writeValueAsString(consent)), guest);
            assertThat(response.getStatus()).as(response.getContentAsString()).isEqualTo(201);
        }
        return guest;
    }

    private int count(String table) {
        return jdbc.queryForObject("SELECT count(*) FROM " + table, Integer.class);
    }

    private MockHttpServletResponse perform(MockHttpServletRequestBuilder request, String authorization) throws Exception {
        return mvc.perform(request.header("Authorization", authorization)).andReturn().getResponse();
    }

    private JsonNode json(MockHttpServletRequestBuilder request, int status, String authorization) throws Exception {
        var response = perform(request.contentType(MediaType.APPLICATION_JSON), authorization);
        assertThat(response.getStatus()).as(response.getContentAsString()).isEqualTo(status);
        String body = response.getContentAsString();
        return body.isEmpty() ? mapper.nullNode() : mapper.readTree(body);
    }
}
