package com.acttub.actingapi.feature.reading;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CopyOnWriteArrayList;

import com.acttub.actingapi.feature.auth.app.JwtService;
import com.acttub.actingapi.feature.reading.app.ScriptCocreateModel;
import com.acttub.actingapi.support.AccountFixtures;
import com.acttub.actingapi.support.MutableClock;
import com.acttub.actingapi.support.PostgresContainerSupport;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
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
 * 찍을 대사 같이 만들기(SOMA-721) — 만들기·다시 보내기·고치기·되돌리기·확정을 HTTP 와 실제 Postgres 로 본다. 확정한 대본이
 * 기존 「내 대본」(reading.script)으로 읽히는지도 본다. 모델은 가짜다(1분 독백 하나를 낸다).
 */
@SpringBootTest(properties = {
    "JWT_SECRET=test-secret",
    "ACCOUNT_CLEANUP_ENABLED=false",
    "ACCOUNT_HOUSEKEEPING_ENABLED=false"
})
@AutoConfigureMockMvc
@Import({MutableClock.Fixture.class, ScriptCocreateIT.FakeModel.class})
class ScriptCocreateIT {
    private static final OffsetDateTime PUBLISHED = OffsetDateTime.of(2026, 10, 1, 0, 0, 0, 0, ZoneOffset.UTC);

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        String name = PostgresContainerSupport.createDatabaseName("script_cocreate");
        registry.add("spring.datasource.url", () -> PostgresContainerSupport.jdbcUrlFor(name));
        registry.add("spring.datasource.username", PostgresContainerSupport.POSTGRES::getUsername);
        registry.add("spring.datasource.password", PostgresContainerSupport.POSTGRES::getPassword);
    }

    @TestConfiguration(proxyBeanMethods = false)
    static class FakeModel {
        static final List<String> PROMPTS = new CopyOnWriteArrayList<>();

        @Bean
        @Primary
        ScriptCocreateModel fakeScriptCocreateModel(ObjectMapper mapper) {
            return (prompt, maxOutputTokens) -> {
                PROMPTS.add(prompt);
                ObjectNode node = mapper.createObjectNode();
                node.putObject("design").put("relation", "친구, 반말").put("incident", "생일을 잊었다").put("prop", "영수증")
                        .put("my_objective", "사과를 받는다").put("other_reason", "자존심").put("turn_action", "영수증을 내민다");
                node.put("title", PROMPTS.size() == 1 ? "잊어버린 생일" : "고친 생일");
                node.put("scene", "옥상, 밤");
                node.putArray("characters").addObject().put("name", "지수").put("gender", "f").put("age_band", "young")
                        .put("mine", true);
                ArrayNode lines = node.putArray("lines");
                lines.addObject().put("kind", "scene").putNull("character").put("text", "옥상, 밤");
                for (int i = 0; i < 12; i++) {
                    lines.addObject().put("kind", "dialogue").put("character", "지수").put("text", "어제 네가 두고 간 영수증 아직 내 가방에 있어");
                }
                lines.addObject().put("kind", "direction").putNull("character").put("text", "영수증을 내민다");
                node.put("note", "마지막 대사를 담담하게 바꿨어요.");
                return new ScriptCocreateModel.Reply(node.toString(), "fake-model");
            };
        }
    }

    @Autowired
    com.acttub.actingapi.feature.reading.app.ScriptCocreateRepository cocreations;
    @Autowired
    com.acttub.actingapi.feature.reading.app.ScriptCocreateService cocreateService;
    @Autowired
    MockMvc mvc;
    @Autowired
    JdbcTemplate jdbc;
    @Autowired
    ObjectMapper mapper;
    @Autowired
    JwtService jwt;
    @Autowired
    MutableClock clock;

    private UUID member;
    private String bearer;

    @BeforeEach
    void setUp() {
        jdbc.execute("TRUNCATE TABLE users,consent_documents RESTART IDENTITY CASCADE");
        for (String type : List.of("terms", "privacy", "ai_analysis", "retention")) {
            jdbc.update("""
                    INSERT INTO consent_documents(id,type,version,title,body,required,published_at)
                    VALUES (?,?,'v1',?,?,?,?)
                    """, UUID.randomUUID(), type, type + " 제목", type + " 본문", !"retention".equals(type), PUBLISHED);
        }
        clock.set(Instant.parse("2026-10-22T08:00:00Z"));
        FakeModel.PROMPTS.clear();
        member = member();
        bearer = bearer(member);
    }

    @Test
    void saveSerializesWithRevisionAndRollsBackWithoutOrphan() throws Exception {
        UUID id = UUID.fromString(json(post("/v2/sample-scripts").content("""
                {"request_id":"%s","character_count":1,"length_minutes":1}
                """.formatted(UUID.randomUUID())), bearer, 201).path("id").textValue());
        Instant now = clock.instant();
        assertThat(cocreations.claim(member, id, 1, 3, now, now.minusSeconds(300))).isTrue();
        org.assertj.core.api.Assertions.assertThatThrownBy(() -> cocreateService.save(member, false, id))
                .hasMessage("sample_script_busy");
        assertThat(jdbc.queryForObject("SELECT count(*) FROM scripts WHERE user_id=?", Integer.class, member)).isZero();
        cocreations.release(id);

        // create + link must both roll back, preserving a clean idempotent retry.
        org.assertj.core.api.Assertions.assertThatThrownBy(() -> cocreations.withSaveLock(member, id, row -> {
            cocreateService.save(member, false, id);
            throw new IllegalStateException("rollback");
        })).hasMessage("rollback");
        assertThat(cocreations.find(member, id).scriptId()).isNull();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM scripts WHERE user_id=?", Integer.class, member)).isZero();

        var started = new java.util.concurrent.CountDownLatch(1);
        var executor = java.util.concurrent.Executors.newSingleThreadExecutor();
        try {
            var claim = cocreations.withSaveLock(member, id, row -> {
                var future = executor.submit(() -> {
                    started.countDown();
                    return cocreations.claim(member, id, 1, 3, now, now.minusSeconds(300));
                });
                try {
                    assertThat(started.await(5, java.util.concurrent.TimeUnit.SECONDS)).isTrue();
                    org.assertj.core.api.Assertions.assertThatThrownBy(() -> future.get(200, java.util.concurrent.TimeUnit.MILLISECONDS))
                            .isInstanceOf(java.util.concurrent.TimeoutException.class);
                } catch (InterruptedException e) {
                    throw new IllegalStateException(e);
                }
                cocreateService.save(member, false, id);
                return future;
            });
            assertThat(claim.get(5, java.util.concurrent.TimeUnit.SECONDS)).isFalse();
        } finally {
            executor.shutdownNow();
        }
        var saved = cocreateService.save(member, false, id);
        assertThat(saved.created()).isFalse();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM scripts WHERE user_id=?", Integer.class, member)).isEqualTo(1);
        var before = cocreations.find(member, id);
        org.assertj.core.api.Assertions.assertThatThrownBy(() -> cocreations.appendVersion(id, before.versions(), 2, now))
                .hasMessage("sample_script_version_conflict");
        assertThat(cocreations.find(member, id).versions()).isEqualTo(before.versions());
        assertThat(cocreations.find(member, id).currentVersion()).isEqualTo(1);
    }

    @Test
    @DisplayName("SOMA-721: 1분 독백을 만들고(201) 같은 request_id 는 모델 없이 200, 고치면 버전 2·수정 1회, 되돌려도 횟수는 그대로, "
            + "확정하면 「내 대본」에 배역·줄이 그대로 저장되고(201) 다시 확정하면 같은 대본(200)")
    void createReviseRestoreSave() throws Exception {
        String requestId = UUID.randomUUID().toString();
        String body = """
                {"request_id":"%s","experience":"beginner","age":24,"gender":"female","goal":"hobby","emotion":"서운함",
                 "situation":"친구가 내 생일을 잊었어요","direction":null,"character_count":1,"length_minutes":1}
                """.formatted(requestId);
        JsonNode created = json(post("/v2/sample-scripts").content(body), bearer, 201);
        assertThat(created.path("title").textValue()).isEqualTo("잊어버린 생일");
        assertThat(created.path("version").intValue()).isEqualTo(1);
        assertThat(created.path("character_count").intValue()).isEqualTo(1);
        assertThat(created.path("length_minutes").intValue()).isEqualTo(1);
        assertThat(created.path("revisions_left").intValue()).isEqualTo(3);
        assertThat(created.path("script_id").isNull()).isTrue();
        assertThat(created.path("design").path("my_objective").textValue()).isEqualTo("사과를 받는다");
        assertThat(created.path("lines")).hasSize(14);
        String id = created.path("id").textValue();

        JsonNode replay = json(post("/v2/sample-scripts").content(body), bearer, 200);
        assertThat(replay.path("id").textValue()).isEqualTo(id);
        assertThat(FakeModel.PROMPTS).hasSize(1);

        JsonNode revised = json(post("/v2/sample-scripts/{id}/revisions", id)
                .content("{\"base_version\":1,\"text\":\"마지막 대사만 담담하게\"}"), bearer, 200);
        assertThat(revised.path("version").intValue()).isEqualTo(2);
        assertThat(revised.path("revisions_used").intValue()).isEqualTo(1);
        assertThat(revised.path("note").textValue()).isEqualTo("마지막 대사를 담담하게 바꿨어요.");
        assertThat(perform(post("/v2/sample-scripts/{id}/revisions", id).content("{\"base_version\":1,\"text\":\"또\"}"), bearer, 409)
                .getContentAsString()).contains("sample_script_version_conflict");

        JsonNode restored = json(post("/v2/sample-scripts/{id}/restore", id).content("{\"version\":1}"), bearer, 200);
        assertThat(restored.path("version").intValue()).isEqualTo(1);
        assertThat(restored.path("revisions_used").intValue()).isEqualTo(1);
        assertThat(restored.path("title").textValue()).isEqualTo("잊어버린 생일");

        JsonNode saved = json(post("/v2/sample-scripts/{id}/save", id), bearer, 201);
        String scriptId = saved.path("script_id").textValue();
        JsonNode script = json(get("/v2/reading/scripts/{id}", scriptId), bearer, 200);
        assertThat(script.path("title").textValue()).isEqualTo("잊어버린 생일");
        assertThat(script.path("source").textValue()).isEqualTo("typed");
        assertThat(script.path("characters")).hasSize(1);
        assertThat(script.path("characters").get(0).path("name").textValue()).isEqualTo("지수");
        assertThat(script.path("lines")).hasSize(14);
        assertThat(json(post("/v2/sample-scripts/{id}/save", id), bearer, 200).path("script_id").textValue()).isEqualTo(scriptId);
        assertThat(json(get("/v2/sample-scripts/{id}", id), bearer, 200).path("script_id").textValue()).isEqualTo(scriptId);
        assertThat(perform(post("/v2/sample-scripts/{id}/revisions", id).content("{\"base_version\":1,\"text\":\"또\"}"), bearer, 409)
                .getContentAsString()).contains("sample_script_saved");
    }

    @Test
    @DisplayName("SOMA-721: 남의 생성 대본은 404, 바꿀 것이 없으면 422, 모르는 키는 422, 대본을 지우면 연결만 끊긴다")
    void ownershipAndValidation() throws Exception {
        String id = json(post("/v2/sample-scripts").content("""
                {"request_id":"%s","character_count":1,"length_minutes":1}
                """.formatted(UUID.randomUUID())), bearer, 201).path("id").textValue();
        String other = bearer(member());
        assertThat(perform(get("/v2/sample-scripts/{id}", id), other, 404).getContentAsString()).contains("sample_script_not_found");
        assertThat(perform(post("/v2/sample-scripts/{id}/revisions", id).content("{\"base_version\":1,\"text\":\" \"}"), bearer, 422)
                .getContentAsString()).contains("sample_script_no_change");
        perform(post("/v2/sample-scripts").content("{\"request_id\":\"%s\",\"unknown\":1}".formatted(UUID.randomUUID())), bearer, 422);
        assertThat(perform(post("/v2/sample-scripts").content("{\"request_id\":\"%s\",\"length_minutes\":2}"
                .formatted(UUID.randomUUID())), bearer, 422).getContentAsString()).contains("sample_script_invalid_options");

        String scriptId = json(post("/v2/sample-scripts/{id}/save", id), bearer, 201).path("script_id").textValue();
        perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete("/v2/reading/scripts/{id}", scriptId),
                bearer, 204);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM script_cocreations WHERE script_id IS NULL", Integer.class)).isEqualTo(1);
    }

    private UUID member() {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO users(id,status) VALUES (?,'active')", id);
        jdbc.update("INSERT INTO user_identities(id,user_id,provider,provider_uid) VALUES (?,?,'google',?)",
                UUID.randomUUID(), id, "g-" + id);
        AccountFixtures.passGate(jdbc, id);
        return id;
    }

    private String bearer(UUID userId) {
        return "Bearer " + jwt.issueAccessToken(userId).value();
    }

    private JsonNode json(MockHttpServletRequestBuilder request, String authorization, int status) throws Exception {
        String body = perform(request, authorization, status).getContentAsString();
        return body.isEmpty() ? mapper.nullNode() : mapper.readTree(body);
    }

    private MockHttpServletResponse perform(MockHttpServletRequestBuilder request, String authorization, int status)
            throws Exception {
        MockHttpServletResponse response = mvc.perform(request
                        .header("Authorization", authorization)
                        .contentType(MediaType.APPLICATION_JSON))
                .andReturn()
                .getResponse();
        assertThat(response.getStatus()).as(response.getContentAsString()).isEqualTo(status);
        return response;
    }
}
