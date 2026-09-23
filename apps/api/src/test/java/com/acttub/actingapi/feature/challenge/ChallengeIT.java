package com.acttub.actingapi.feature.challenge;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;

import com.acttub.actingapi.feature.auth.app.JwtService;
import com.acttub.actingapi.support.AccountFixtures;
import com.acttub.actingapi.support.PostgresContainerSupport;
import com.acttub.actingapi.support.MutableClock;
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

/** 챌린지 공개 HTTP 계약. 실제 Postgres를 쓰고 모델·스토리지 호출 없이 개설·노출을 검증한다. */
@SpringBootTest(properties = {"JWT_SECRET=test-secret", "ANALYSIS_WORKER_ENABLED=false",
        "ACCOUNT_CLEANUP_ENABLED=false", "ACCOUNT_HOUSEKEEPING_ENABLED=false", "ADMIN_OPS_TOKEN=challenge-test-ops"})
@AutoConfigureMockMvc
@Import(MutableClock.Fixture.class)
class ChallengeIT {
    static final Instant NOW = Instant.parse("2026-09-23T03:00:00Z");
    @DynamicPropertySource static void database(DynamicPropertyRegistry registry) {
        String name = PostgresContainerSupport.createDatabaseName("challenge");
        registry.add("spring.datasource.url", () -> PostgresContainerSupport.jdbcUrlFor(name));
        registry.add("spring.datasource.username", PostgresContainerSupport.POSTGRES::getUsername);
        registry.add("spring.datasource.password", PostgresContainerSupport.POSTGRES::getPassword);
    }
    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate jdbc;
    @Autowired ObjectMapper json;
    @Autowired JwtService jwt;
    @Autowired MutableClock clock;
    @Autowired org.springframework.transaction.PlatformTransactionManager transactionManager;
    UUID user;
    String bearer;

    @BeforeEach void prepare() {
        clock.set(NOW);
        jdbc.execute("TRUNCATE users,challenges RESTART IDENTITY CASCADE");
        user = UUID.randomUUID();
        jdbc.update("INSERT INTO users(id,status) VALUES (?,'active')", user);
        jdbc.update("INSERT INTO user_identities(id,user_id,provider,provider_uid) VALUES (?,?,'google',?)",
                UUID.randomUUID(), user, user.toString());
        AccountFixtures.passGate(jdbc, user);
        bearer = "Bearer " + jwt.issueAccessToken(user).value();
    }

    @Test void challengeCreate_memberCanOpenASevenDayChallengeAndReadIt() throws Exception {
        JsonNode created = response(post("/v2/challenges").content(json.writeValueAsString(Map.of(
                "request_id", UUID.randomUUID(), "line", "  가지   마. ", "work", "창작", "duration_days", 7))), 201);
        assertThat(created.path("line").asText()).isEqualTo("가지 마.");
        assertThat(created.path("work").asText()).isEqualTo("창작");
        assertThat(created.path("origin").asText()).isEqualTo("member");
        assertThat(created.path("moderation").asText()).isEqualTo("visible");
        assertThat(created.path("host_name").asText()).isEqualTo("테스트 배우");
        assertThat(created.path("is_host").asBoolean()).isTrue();
        assertThat(created.path("entry_count").asInt()).isZero();
        assertThat(created.path("participants")).isEmpty();
        assertThat(Instant.parse(created.path("starts_at").asText())).isEqualTo(NOW);
        assertThat(Instant.parse(created.path("ends_at").asText())).isEqualTo(Instant.parse("2026-09-30T03:00:00Z"));
        assertThat(response(get("/v2/challenges/{id}", created.path("id").asText()), 200)).isEqualTo(created);
    }

    @Test void challengeCreate_replayPrecedesQuotaAndChangedBodiesAreRejected() throws Exception {
        String body = json.writeValueAsString(Map.of("request_id", UUID.randomUUID(), "line", "돌아와 줘.",
                "work", "창작", "duration_days", 14));
        JsonNode first = response(post("/v2/challenges").content(body), 201);
        for (String line : new String[]{"두 번째", "세 번째"}) {
            response(post("/v2/challenges").content(json.writeValueAsString(Map.of(
                    "request_id", UUID.randomUUID(), "line", line, "work", "창작", "duration_days", 7))), 201);
        }
        assertThat(response(post("/v2/challenges").content(body), 200)).isEqualTo(first);
        assertThat(response(post("/v2/challenges").content(body.replace("돌아와 줘.", "다른 대사")), 422)
                .path("detail").asText()).isEqualTo("request_fingerprint_mismatch");
        assertThat(response(post("/v2/challenges").content(json.writeValueAsString(Map.of(
                "request_id", UUID.randomUUID(), "line", "네 번째", "work", "창작", "duration_days", 7))), 429)
                .path("detail").asText()).isEqualTo("daily_challenge_limit");
        assertThat(Instant.parse(first.path("ends_at").asText())).isEqualTo(Instant.parse("2026-10-07T03:00:00Z"));
    }

    @Test void challengeCreate_concurrentNormalizedDuplicateOnlyCreatesOneChallenge() throws Exception {
        try (var executor = java.util.concurrent.Executors.newFixedThreadPool(2)) {
            var ready = new java.util.concurrent.CountDownLatch(2);
            var go = new java.util.concurrent.CountDownLatch(1);
            var requests = new java.util.ArrayList<java.util.concurrent.Future<org.springframework.mock.web.MockHttpServletResponse>>();
            for (String line : new String[]{"같은 대사", " 같은   대사 "}) {
                String body = json.writeValueAsString(Map.of("request_id", UUID.randomUUID(), "line", line,
                        "work", "창작", "duration_days", 7));
                requests.add(executor.submit(() -> {
                    ready.countDown();
                    assertThat(go.await(10, java.util.concurrent.TimeUnit.SECONDS)).isTrue();
                    return mvc.perform(post("/v2/challenges").header("Authorization", bearer)
                            .header("X-Acttub-Client", "app/1.0.0").header("Accept-Language", "ko")
                            .contentType(MediaType.APPLICATION_JSON).content(body)).andReturn().getResponse();
                }));
            }
            assertThat(ready.await(10, java.util.concurrent.TimeUnit.SECONDS)).isTrue();
            go.countDown();
            var responses = new java.util.ArrayList<org.springframework.mock.web.MockHttpServletResponse>();
            for (var request : requests) responses.add(request.get(20, java.util.concurrent.TimeUnit.SECONDS));
            assertThat(responses.stream().map(r -> r.getStatus())).containsExactlyInAnyOrder(201, 422);
            for (var r : responses) if (r.getStatus() == 422) {
                assertThat(json.readTree(r.getContentAsString()).path("detail").asText()).isEqualTo("duplicate_challenge");
            }
        }
    }

    @Test void challengeCreate_quotaResetsAtKoreanMidnightAndEndedLinesCanBeOpenedAgain() throws Exception {
        clock.set(Instant.parse("2026-09-23T14:59:59Z"));
        for (int i=0; i<3; i++) create("오늘 대사 " + i, 201);
        create("하나 더", 429);
        clock.set(Instant.parse("2026-09-23T15:00:00Z"));
        create("다음 날 대사", 201);
        assertThat(create("오늘 대사 0", 422).path("detail").asText()).isEqualTo("duplicate_challenge");
        clock.set(Instant.parse("2026-09-30T15:00:00Z"));
        create("오늘 대사 0", 201);
    }

    @Test void challengeCreate_countsUnicodeAfterNormalizationAndRejectsUnsupportedDuration() throws Exception {
        create("  " + "😀".repeat(200) + "  ", 201);
        assertThat(create("😀".repeat(201), 422).path("detail").isArray()).isTrue();
        assertThat(create("   ", 422).path("detail").isArray()).isTrue();
        assertThat(response(post("/v2/challenges").content(json.writeValueAsString(Map.of(
                "request_id", UUID.randomUUID(), "line", "짧은 대사", "work", "창작", "duration_days", 10))), 422)
                .path("detail").asText()).isEqualTo("invalid_duration");
    }

    private JsonNode create(String line, int status) throws Exception {
        return response(post("/v2/challenges").content(json.writeValueAsString(Map.of(
                "request_id", UUID.randomUUID(), "line", line, "work", "창작", "duration_days", 7))), status);
    }

    @Test void challengeBrowse_searchesLineAndWorkButNotCharacterAndSeparatesEndedTab() throws Exception {
        JsonNode first = create("달빛 아래서", 201);
        clock.advance(java.time.Duration.ofSeconds(1));
        JsonNode characterOnly = response(post("/v2/challenges").content(json.writeValueAsString(Map.of(
                "request_id", UUID.randomUUID(), "line", "떠나", "work", "창작", "character", "달빛", "duration_days", 7))), 201);
        clock.advance(java.time.Duration.ofSeconds(1));
        JsonNode workMatch = response(post("/v2/challenges").content(json.writeValueAsString(Map.of(
                "request_id", UUID.randomUUID(), "line", "기다려", "work", "달빛", "duration_days", 7))), 201);
        JsonNode search = response(get("/v2/challenges").param("tab", "latest").param("q", "달빛"), 200);
        assertThat(search.path("featured").isNull()).isTrue();
        assertThat(search.path("challenges").findValuesAsText("id"))
                .containsExactly(workMatch.path("id").asText(), first.path("id").asText());
        JsonNode latest = response(get("/v2/challenges").param("tab", "latest"), 200);
        assertThat(latest.at("/featured/id")).isEqualTo(workMatch.path("id"));
        assertThat(latest.path("challenges").findValuesAsText("id"))
                .containsExactly(characterOnly.path("id").asText(), first.path("id").asText());
        clock.advance(java.time.Duration.ofDays(8));
        JsonNode ended = response(get("/v2/challenges").param("tab", "ended"), 200);
        assertThat(ended.path("featured").isNull()).isTrue();
        assertThat(ended.path("challenges").findValuesAsText("id"))
                .containsExactly(workMatch.path("id").asText(), characterOnly.path("id").asText(), first.path("id").asText());
        assertThat(response(get("/v2/challenges").param("tab", "latest"), 200).path("challenges")).isEmpty();
    }

    private JsonNode response(MockHttpServletRequestBuilder request, int expected) throws Exception {
        return response(request, expected, bearer);
    }

    @Test void challengeManagement_featuredDayIsUniqueAndModerationPreservesThePeriod() throws Exception {
        String body = json.writeValueAsString(Map.of("request_id", UUID.randomUUID(), "origin", "team",
                "line", "오늘의 대사", "work", "창작", "duration_days", 7, "featured_on", "2026-09-23"));
        response(post("/v2/admin/challenges").content(body), 401);
        JsonNode team = response(post("/v2/admin/challenges").content(body), 201, "Bearer challenge-test-ops");
        assertThat(team.path("origin").asText()).isEqualTo("team");
        assertThat(team.path("host_name").isNull()).isTrue();
        assertThat(response(post("/v2/admin/challenges").content(body), 200, "Bearer challenge-test-ops")).isEqualTo(team);
        assertThat(response(get("/v2/challenges"), 200).at("/featured/id")).isEqualTo(team.path("id"));
        assertThat(response(post("/v2/admin/challenges").content(json.writeValueAsString(Map.of("request_id", UUID.randomUUID(),
                "line", "겹친 선정", "work", "창작", "duration_days", 7, "featured_on", "2026-09-23"))), 422, "Bearer challenge-test-ops")
                .path("detail").asText()).isEqualTo("featured_date_conflict");
        assertThat(response(post("/v2/admin/challenges").content(body.replace("오늘의 대사", "바뀐 대사")), 422, "Bearer challenge-test-ops")
                .path("detail").asText()).isEqualTo("request_fingerprint_mismatch");
        assertThat(response(post("/v2/admin/challenges").content(body.replace("\"duration_days\":7", "\"duration_days\":10")), 422, "Bearer challenge-test-ops")
                .path("detail").asText()).isEqualTo("invalid_duration");
        String path = "/v2/admin/challenges/" + team.path("id").asText() + "/moderation";
        response(patch(path).content("{\"moderation\":\"review\"}"), 200, "Bearer challenge-test-ops");
        response(get("/v2/challenges/{id}", team.path("id").asText()), 404);
        assertThat(response(get("/v2/challenges"), 200).path("featured").isNull()).isTrue();
        clock.advance(java.time.Duration.ofDays(8));
        response(patch(path).content("{\"moderation\":\"visible\"}"), 200, "Bearer challenge-test-ops");
        assertThat(response(get("/v2/challenges").param("tab", "ended"), 200).at("/challenges/0/id")).isEqualTo(team.path("id"));
        assertThat(response(patch("/v2/admin/challenges/{id}/moderation", UUID.randomUUID())
                .content("{\"moderation\":\"visible\"}"), 404, "Bearer challenge-test-ops").path("detail").asText())
                .isEqualTo("challenge_not_found");
    }

    @Test void challengeAccess_requiresAKoreanAppMember() throws Exception {
        for (String[] context : new String[][]{{"web/1.0.0", "ko"}, {"app/1.0.0", "en"}}) {
            var response = mvc.perform(get("/v2/challenges").header("Authorization", bearer)
                    .header("X-Acttub-Client", context[0]).header("Accept-Language", context[1]))
                    .andReturn().getResponse();
            assertThat(response.getStatus()).isEqualTo(403);
            assertThat(json.readTree(response.getContentAsString()).path("detail").asText()).isEqualTo("member_only");
        }
        jdbc.update("UPDATE user_identities SET provider='guest' WHERE user_id=?", user);
        assertThat(response(get("/v2/challenges"), 403).path("detail").asText()).isEqualTo("member_only");
    }

    @Test void challengeCreate_withdrawalBeforeTheWritePreventsALateChallenge() throws Exception {
        var transaction = new org.springframework.transaction.support.TransactionTemplate(transactionManager);
        String body = json.writeValueAsString(Map.of("request_id", UUID.randomUUID(), "line", "늦은 개설",
                "work", "창작", "duration_days", 7));
        try (var executor = java.util.concurrent.Executors.newSingleThreadExecutor()) {
            var response = transaction.execute(status -> {
                int locker = jdbc.queryForObject("SELECT pg_backend_pid()", Integer.class);
                jdbc.queryForObject("SELECT id FROM users WHERE id=? FOR UPDATE", UUID.class, user);
                var request = executor.submit(() -> mvc.perform(post("/v2/challenges").contentType(MediaType.APPLICATION_JSON)
                        .header("Authorization", bearer).header("X-Acttub-Client", "app/1.0.0")
                        .header("Accept-Language", "ko").content(body)).andReturn().getResponse());
                org.awaitility.Awaitility.await().atMost(java.time.Duration.ofSeconds(10)).until(() ->
                        jdbc.queryForObject("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE ?=ANY(pg_blocking_pids(pid)))",
                                Boolean.class, locker));
                jdbc.update("UPDATE users SET status='deactivated',deactivated_at=now() WHERE id=?", user);
                return request;
            }).get(20, java.util.concurrent.TimeUnit.SECONDS);
            assertThat(response.getStatus()).isEqualTo(403);
            assertThat(json.readTree(response.getContentAsString()).path("detail").asText()).isEqualTo("account_deactivated");
        }
        jdbc.update("UPDATE users SET status='active',deactivated_at=NULL WHERE id=?", user);
        assertThat(response(get("/v2/challenges"), 200).path("challenges")).isEmpty();
        assertThat(response(get("/v2/challenges"), 200).path("featured").isNull()).isTrue();
    }

    private JsonNode response(MockHttpServletRequestBuilder request, int expected, String authorization) throws Exception {
        var result = mvc.perform(request.header("Authorization", authorization).header("X-Acttub-Client", "app/1.0.0")
                .header("Accept-Language", "ko").contentType(MediaType.APPLICATION_JSON)).andReturn();
        var response = result.getResponse();
        assertThat(response.getStatus()).as("%s (%s)", response.getContentAsString(), result.getResolvedException()).isEqualTo(expected);
        return response.getContentAsString().isBlank() ? json.nullNode() : json.readTree(response.getContentAsString());
    }

    @Test void challengeBrowse_countsPublicEntriesGloballyButFiltersPeopleAndSearchForTheViewer() throws Exception {
        UUID challenge = UUID.fromString(create("같이 읽을 장면", 201).path("id").asText());
        UUID other = UUID.fromString(create("내 비공개 참여", 201).path("id").asText());
        UUID blocked = actor("가려진 배우");
        UUID nina = actor("니나");
        likes(entry(challenge, blocked, "public", "visible"), 2);
        likes(entry(challenge, blocked, "public", "visible"), 1);
        likes(entry(challenge, nina, "public", "visible"), 4);
        likes(entry(challenge, actor("비공개 배우"), "private", "visible"), 5);
        likes(entry(challenge, actor("확인 중 배우"), "public", "hidden_by_report"), 5);
        UUID purged = entry(challenge, actor("파기 배우"), "public", "visible");
        jdbc.update("UPDATE videos SET purged_at=now() WHERE id=(SELECT video_id FROM challenge_entries WHERE id=?)", purged);
        UUID withdrawn = actor("탈퇴 배우");
        entry(challenge, withdrawn, "public", "visible");
        jdbc.update("UPDATE users SET status='deactivated',deactivated_at=now() WHERE id=?", withdrawn);
        entry(other, user, "private", "visible");
        jdbc.update("INSERT INTO user_blocks(id,blocker_id,blocked_id) VALUES (?,?,?)", UUID.randomUUID(), user, blocked);

        JsonNode detail = response(get("/v2/challenges/{id}", challenge), 200);
        assertThat(detail.path("entry_count").asLong()).isEqualTo(3);
        assertThat(detail.path("like_sum").asLong()).isEqualTo(7);
        assertThat(detail.path("participants").findValuesAsText("name")).containsExactly("니나");
        assertThat(detail.path("more_count").asLong()).isZero();
        assertThat(detail.toString()).doesNotContain("photo", "bio");
        assertThat(response(get("/v2/challenges").param("tab", "popular"), 200).at("/featured/id").asText())
                .isEqualTo(challenge.toString());
        assertThat(response(get("/v2/challenges").param("q", "니나"), 200).path("challenges").findValuesAsText("id"))
                .containsExactly(challenge.toString());
        assertThat(response(get("/v2/challenges").param("q", "가려진"), 200).path("challenges")).isEmpty();
        assertThat(response(get("/v2/challenges").param("q", "x"), 200)).isEqualTo(response(get("/v2/challenges"), 200));
        jdbc.update("DELETE FROM user_blocks");
        jdbc.update("INSERT INTO user_blocks(id,blocker_id,blocked_id) VALUES (?,?,?)", UUID.randomUUID(), blocked, user);
        assertThat(response(get("/v2/challenges").param("q", "가려진"), 200).path("challenges")).isEmpty();
        JsonNode mine = response(get("/v2/challenges").param("tab", "mine"), 200);
        assertThat(mine.path("featured").isNull()).isTrue();
        assertThat(mine.path("challenges").findValuesAsText("id")).containsExactly(other.toString());
    }

    private UUID actor(String name) {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO users(id,status) VALUES (?,'active')", id);
        AccountFixtures.completeProfile(jdbc, id);
        jdbc.update("UPDATE user_profiles SET name=? WHERE user_id=?", name, id);
        return id;
    }

    @Test void challengeDelete_keepsCreationHistoryAndCannotDeleteAnEverEnteredChallenge() throws Exception {
        String body = json.writeValueAsString(Map.of("request_id", UUID.randomUUID(), "line", "지울 대사",
                "work", "창작", "duration_days", 7));
        JsonNode created = response(post("/v2/challenges").content(body), 201);
        String id = created.path("id").asText();
        UUID stranger = actor("다른 배우");
        AccountFixtures.grantAllConsents(jdbc, stranger);
        assertThat(response(delete("/v2/challenges/{id}", id), 404, "Bearer " + jwt.issueAccessToken(stranger).value())
                .path("detail").asText()).isEqualTo("challenge_not_found");
        response(delete("/v2/challenges/{id}", id), 204);
        response(delete("/v2/challenges/{id}", id), 204);
        response(get("/v2/challenges/{id}", id), 404);
        assertThat(response(post("/v2/challenges").content(body), 200).path("id")).isEqualTo(created.path("id"));
        create("삭제해도 한도에 남음", 201);
        UUID entered = UUID.fromString(create("참여 이력이 있는 대사", 201).path("id").asText());
        UUID entry = entry(entered, stranger, "public", "visible");
        assertThat(response(delete("/v2/challenges/{id}", entered), 422).path("detail").asText())
                .isEqualTo("challenge_has_entries");
        jdbc.update("UPDATE challenge_entries SET status='deleted',video_id=NULL,caption=NULL,deleted_at=now() WHERE id=?", entry);
        assertThat(response(delete("/v2/challenges/{id}", entered), 422).path("detail").asText())
                .isEqualTo("challenge_has_entries");
        assertThat(create("네 번째는 안 됨", 429).path("detail").asText()).isEqualTo("daily_challenge_limit");
    }

    private UUID entry(UUID challenge, UUID owner, String visibility, String status) {
        UUID video = UUID.randomUUID();
        jdbc.update("INSERT INTO videos(id,user_id,object_key,content_type,byte_size,duration_ms) VALUES (?,?,?,'video/mp4',100,30000)",
                video, owner, "videos/" + video);
        UUID id = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO challenge_entries(id,challenge_id,user_id,video_id,visibility,status,request_id,
                                              request_fingerprint,published_at)
                VALUES (?,?,?,?,?,?,?, ?,CASE WHEN ?='public' THEN now() ELSE NULL END)
                """, id, challenge, owner, video, visibility, status, UUID.randomUUID(), "0".repeat(64), visibility);
        return id;
    }

    private void likes(UUID entry, int count) {
        for (int i=0; i<count; i++) {
            UUID id = UUID.randomUUID();
            jdbc.update("INSERT INTO users(id,status) VALUES (?,'active')", id);
            jdbc.update("INSERT INTO entry_likes(id,entry_id,user_id) VALUES (?,?,?)", UUID.randomUUID(), entry, id);
        }
    }

    @Test void challengeBrowse_pagesTwentyCardsWithoutRepeatingThePinnedChallenge() throws Exception {
        var ids = new java.util.ArrayList<String>();
        for (int i=0; i<26; i++) {
            clock.advance(java.time.Duration.ofSeconds(1));
            var created = response(post("/v2/admin/challenges").content(json.writeValueAsString(Map.of(
                    "request_id", UUID.randomUUID(), "line", "페이지 대사 " + i, "work", "창작", "duration_days", 7))),
                    201, "Bearer challenge-test-ops");
            ids.add(created.path("id").asText());
        }
        JsonNode first = response(get("/v2/challenges").param("tab", "latest"), 200);
        assertThat(first.path("challenges")).hasSize(20);
        assertThat(first.at("/featured/id").asText()).isEqualTo(ids.getLast());
        assertThat(first.path("next_cursor").isTextual()).isTrue();
        JsonNode second = response(get("/v2/challenges").param("tab", "latest")
                .param("cursor", first.path("next_cursor").asText()), 200);
        assertThat(second.path("challenges")).hasSize(5);
        assertThat(second.path("next_cursor").isNull()).isTrue();
        var seen = new java.util.ArrayList<String>();
        seen.add(first.at("/featured/id").asText());
        seen.addAll(first.path("challenges").findValuesAsText("id"));
        seen.addAll(second.path("challenges").findValuesAsText("id"));
        java.util.Collections.reverse(ids);
        assertThat(seen).containsExactlyElementsOf(ids);
        assertThat(response(get("/v2/challenges").param("tab", "latest").param("q", "다른 검색")
                .param("cursor", first.path("next_cursor").asText()), 422).path("detail").isArray()).isTrue();
        assertThat(response(get("/v2/challenges").param("cursor", "not-a-cursor"), 422).path("detail").isArray()).isTrue();
    }

    @Test void challengeBrowse_usesTheLatestPastSelectionThenPublicEntryCountAndNeverPinsTomorrowEarly() throws Exception {
        UUID popular = UUID.fromString(response(post("/v2/challenges").content(json.writeValueAsString(Map.of(
                "request_id", UUID.randomUUID(), "line", "참여 많은 장면", "work", "창작", "duration_days", 14))), 201)
                .path("id").asText());
        entry(popular, actor("참여자 하나"), "public", "visible");
        entry(popular, actor("참여자 둘"), "public", "visible");
        UUID yesterday = team("어제 선정", "2026-09-22");
        clock.advance(java.time.Duration.ofSeconds(1));
        UUID tomorrow = team("내일 선정", "2026-09-24");
        assertThat(response(get("/v2/challenges"), 200).at("/featured/id").asText()).isEqualTo(yesterday.toString());
        clock.advance(java.time.Duration.ofDays(1));
        assertThat(response(get("/v2/challenges"), 200).at("/featured/id").asText()).isEqualTo(tomorrow.toString());
        clock.advance(java.time.Duration.ofDays(7));
        assertThat(response(get("/v2/challenges"), 200).at("/featured/id").asText()).isEqualTo(popular.toString());
        assertThat(response(get("/v2/challenges").param("tab", "ended"), 200).path("featured").isNull()).isTrue();
    }

    private UUID team(String line, String day) throws Exception {
        return UUID.fromString(response(post("/v2/admin/challenges").content(json.writeValueAsString(Map.of(
                "request_id", UUID.randomUUID(), "line", line, "work", "창작", "duration_days", 7, "featured_on", day))),
                201, "Bearer challenge-test-ops").path("id").asText());
    }

}
