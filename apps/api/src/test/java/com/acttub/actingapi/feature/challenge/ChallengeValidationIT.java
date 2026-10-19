package com.acttub.actingapi.feature.challenge;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import java.util.Map;
import java.util.UUID;

import com.acttub.actingapi.feature.auth.app.JwtService;
import com.acttub.actingapi.support.AccountFixtures;
import com.acttub.actingapi.support.PostgresContainerSupport;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

/**
 * 챌린지 HTTP 의 값 검사와 참여작 쪽 넘기기: 모르는 정렬·탭·공개 범위·신고 대상·처리 상태는 저장소에 닿기 전에 422 배열로
 * 거절하고, 참여작 목록은 20개씩 커서로 이어 주며 다른 범위의 커서는 거절한다.
 */
@SpringBootTest(properties = {"JWT_SECRET=test-secret", "ANALYSIS_WORKER_ENABLED=false",
        "ACCOUNT_CLEANUP_ENABLED=false", "ACCOUNT_HOUSEKEEPING_ENABLED=false", "ADMIN_OPS_TOKEN=challenge-validation-ops"})
@AutoConfigureMockMvc
class ChallengeValidationIT {
    static final String OPS = "Bearer challenge-validation-ops";

    @DynamicPropertySource static void database(DynamicPropertyRegistry registry) {
        String name = PostgresContainerSupport.createDatabaseName("challenge_validation");
        registry.add("spring.datasource.url", () -> PostgresContainerSupport.jdbcUrlFor(name));
        registry.add("spring.datasource.username", PostgresContainerSupport.POSTGRES::getUsername);
        registry.add("spring.datasource.password", PostgresContainerSupport.POSTGRES::getPassword);
    }

    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate jdbc;
    @Autowired ObjectMapper json;
    @Autowired JwtService jwt;
    String bearer;
    UUID me;

    @BeforeEach void member() {
        jdbc.execute("TRUNCATE users,challenges RESTART IDENTITY CASCADE");
        UUID user = UUID.randomUUID();
        jdbc.update("INSERT INTO users(id,status) VALUES (?,'active')", user);
        jdbc.update("INSERT INTO user_identities(id,user_id,provider,provider_uid) VALUES (?,?,'google',?)",
                UUID.randomUUID(), user, user.toString());
        AccountFixtures.passGate(jdbc, user);
        bearer = "Bearer " + jwt.issueAccessToken(user).value();
        me = user;
    }

    JsonNode response(MockHttpServletRequestBuilder request, String authorization, int expected) throws Exception {
        var response = mvc.perform(request.header("Authorization", authorization).header("X-Acttub-Client", "app/0.1.0")
                .header("Accept-Language", "ko").contentType(MediaType.APPLICATION_JSON)).andReturn().getResponse();
        assertThat(response.getStatus()).as(response.getContentAsString()).isEqualTo(expected);
        return response.getContentAsString().isBlank() ? json.nullNode() : json.readTree(response.getContentAsString());
    }

    String location(JsonNode body) {
        return body.path("detail").get(0).path("loc").toString();
    }

    @Test void unknownListingValuesAreRejectedWithTheirLocation() throws Exception {
        assertThat(location(response(get("/v2/challenges").param("tab", "weekly"), bearer, 422))).isEqualTo("[\"query\",\"tab\"]");
        assertThat(location(response(get("/v2/challenges/{id}/entries", UUID.randomUUID()).param("sort", "views"), bearer, 422)))
                .isEqualTo("[\"query\",\"sort\"]");
        assertThat(location(response(get("/v2/me/challenge-entries").param("visibility", "friends"), bearer, 422)))
                .isEqualTo("[\"query\",\"visibility\"]");
        assertThat(response(get("/v2/me/challenge-entries").param("visibility", "private"), bearer, 200).path("entries")).isEmpty();
    }

    @Test void anEntryCannotBeMadeVisibleToAnUnknownAudience() throws Exception {
        assertThat(location(response(patch("/v2/entries/{id}", UUID.randomUUID()).content("{\"visibility\":\"friends\"}"), bearer, 422)))
                .isEqualTo("[\"body\",\"visibility\"]");
    }

    @Test void reportsNeedAKnownTargetAndAdminsAKnownStatusResolutionAndReviewer() throws Exception {
        String report = json.writeValueAsString(Map.of("request_id", UUID.randomUUID(), "target_type", "user",
                "target_id", UUID.randomUUID(), "reason", "spam"));
        assertThat(location(response(post("/v2/reports").content(report), bearer, 422))).isEqualTo("[\"body\",\"target_type\"]");
        assertThat(location(response(get("/v2/admin/reports").param("status", "pending"), OPS, 422))).isEqualTo("[\"query\",\"status\"]");
        UUID id = UUID.randomUUID();
        assertThat(location(response(patch("/v2/admin/reports/{id}", id).content("{\"resolution\":\"ignored\",\"reviewer\":\"운영\"}"), OPS, 422)))
                .isEqualTo("[\"body\",\"resolution\"]");
        assertThat(location(response(patch("/v2/admin/reports/{id}", id).content("{\"resolution\":\"dismissed\",\"reviewer\":\"  \"}"), OPS, 422)))
                .isEqualTo("[\"body\",\"reviewer\"]");
    }

    @Test void moderationAndReadMarkersAreChecked() throws Exception {
        assertThat(location(response(patch("/v2/admin/challenges/{id}/moderation", UUID.randomUUID()).content("{\"moderation\":\"banned\"}"), OPS, 422)))
                .isEqualTo("[\"body\",\"moderation\"]");
        assertThat(location(response(post("/v2/me/notifications/read").content("{\"all_before\":{\"created_at\":\"어제\",\"id\":\"x\"}}"), bearer, 422)))
                .isEqualTo("[\"body\",\"all_before\",\"created_at\"]");
        response(post("/v2/me/notifications/read").content("{\"all_before\":{\"created_at\":\"2026-10-01T00:00:00Z\",\"id\":\"group-key\"}}"), bearer, 204);
    }

    UUID challenge() throws Exception {
        return UUID.fromString(response(post("/v2/admin/challenges").content(json.writeValueAsString(Map.of(
                "request_id", UUID.randomUUID(), "line", "쪽 넘기기 " + UUID.randomUUID(), "work", "창작", "duration_days", 7))),
                OPS, 201).path("id").asText());
    }

    UUID entry(UUID challenge, UUID owner, int minutesAgo) {
        UUID video = UUID.randomUUID();
        jdbc.update("INSERT INTO videos(id,user_id,object_key,content_type,byte_size,duration_ms) VALUES (?,?,?,'video/mp4',100,30000)",
                video, owner, "videos/" + video);
        UUID id = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO challenge_entries(id,challenge_id,user_id,video_id,visibility,status,request_id,request_fingerprint,
                                              published_at,created_at)
                VALUES (?,?,?,?,'public','visible',?,?,now() - make_interval(mins => ?),now() - make_interval(mins => ?))
                """, id, challenge, owner, video, UUID.randomUUID(), "0".repeat(64), minutesAgo, minutesAgo);
        return id;
    }

    @Test void myEntriesPageTwentyAtATimeAndRejectSomeoneElsesCursor() throws Exception {
        UUID challenge = challenge();
        for (int i = 0; i < 22; i++) entry(challenge, me, i + 1);
        JsonNode first = response(get("/v2/me/challenge-entries"), bearer, 200);
        assertThat(first.path("entries")).hasSize(20);
        assertThat(first.path("counts").path("all").asLong()).isEqualTo(22);
        JsonNode second = response(get("/v2/me/challenge-entries").param("cursor", first.path("next_cursor").asText()), bearer, 200);
        assertThat(second.path("entries")).hasSize(2);
        assertThat(second.path("next_cursor").isNull()).isTrue();

        UUID other = UUID.randomUUID();
        jdbc.update("INSERT INTO users(id,status) VALUES (?,'active')", other);
        AccountFixtures.passGate(jdbc, other);
        assertThat(location(response(get("/v2/me/challenge-entries").param("cursor", first.path("next_cursor").asText()),
                "Bearer " + jwt.issueAccessToken(other).value(), 422))).isEqualTo("[\"query\",\"cursor\"]");
    }

    @Test void theLatestListCanStartFromASharedEntryAndPagesOnWithItsCursor() throws Exception {
        UUID challenge = challenge();
        java.util.List<UUID> entries = new java.util.ArrayList<>();
        for (int i = 0; i < 23; i++) entries.add(entry(challenge, me, i + 1));
        JsonNode fromThird = response(get("/v2/challenges/{id}/entries", challenge).param("sort", "latest")
                .param("from_entry", entries.get(2).toString()), bearer, 200);
        assertThat(fromThird.path("entries").get(0).path("id").asText()).isEqualTo(entries.get(2).toString());
        assertThat(fromThird.path("entries")).hasSize(20);
        JsonNode rest = response(get("/v2/challenges/{id}/entries", challenge).param("sort", "latest")
                .param("cursor", fromThird.path("next_cursor").asText()), bearer, 200);
        assertThat(rest.path("entries").findValuesAsText("id")).containsExactly(entries.get(22).toString());
        assertThat(response(get("/v2/challenges/{id}/entries", challenge).param("sort", "latest")
                .param("from_entry", UUID.randomUUID().toString()), bearer, 404).path("detail").asText()).isEqualTo("entry_not_found");
        UUID another = challenge();
        assertThat(location(response(get("/v2/challenges/{id}/entries", another).param("sort", "latest")
                .param("cursor", fromThird.path("next_cursor").asText()), bearer, 422))).isEqualTo("[\"query\",\"cursor\"]");
    }

    @Test void theLikesListKeepsItsOrderAcrossPagesAndRejectsUnknownStarts() throws Exception {
        UUID challenge = challenge();
        java.util.List<UUID> entries = new java.util.ArrayList<>();
        for (int i = 0; i < 22; i++) entries.add(entry(challenge, me, i + 1));
        JsonNode first = response(get("/v2/challenges/{id}/entries", challenge), bearer, 200);
        assertThat(first.path("entries")).hasSize(20);
        JsonNode second = response(get("/v2/challenges/{id}/entries", challenge).param("cursor", first.path("next_cursor").asText()), bearer, 200);
        assertThat(second.path("entries")).hasSize(2);
        var all = new java.util.ArrayList<String>(first.path("entries").findValuesAsText("id"));
        all.addAll(second.path("entries").findValuesAsText("id"));
        assertThat(all).doesNotHaveDuplicates().hasSize(22);
        assertThat(response(get("/v2/challenges/{id}/entries", challenge).param("from_entry", UUID.randomUUID().toString()), bearer, 404)
                .path("detail").asText()).isEqualTo("entry_not_found");
        assertThat(location(response(get("/v2/challenges/{id}/entries", challenge).param("cursor", "bm90LWEtY3Vyc29y"), bearer, 422)))
                .isEqualTo("[\"query\",\"cursor\"]");
    }

    UUID actor() {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO users(id,status) VALUES (?,'active')", id);
        AccountFixtures.passGate(jdbc, id);
        return id;
    }

    @Test void savedEntriesPageWithTheirOwnCursorOnly() throws Exception {
        UUID challenge = challenge();
        UUID author = actor();
        for (int i = 0; i < 22; i++) {
            UUID entry = entry(challenge, author, i + 1);
            response(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put("/v2/entries/{id}/save", entry), bearer, 200);
        }
        JsonNode first = response(get("/v2/me/saved-entries"), bearer, 200);
        assertThat(first.path("entries")).hasSize(20);
        JsonNode second = response(get("/v2/me/saved-entries").param("cursor", first.path("next_cursor").asText()), bearer, 200);
        assertThat(second.path("entries")).hasSize(2);
        assertThat(second.path("next_cursor").isNull()).isTrue();
        assertThat(location(response(get("/v2/me/saved-entries").param("cursor", first.path("next_cursor").asText()),
                "Bearer " + jwt.issueAccessToken(author).value(), 422))).isEqualTo("[\"query\",\"cursor\"]");
        String broken = java.util.Base64.getUrlEncoder().withoutPadding().encodeToString(
                ("V|" + me + "|어제|" + UUID.randomUUID()).getBytes(java.nio.charset.StandardCharsets.UTF_8));
        assertThat(location(response(get("/v2/me/saved-entries").param("cursor", broken), bearer, 422))).isEqualTo("[\"query\",\"cursor\"]");
    }

    @Test void commentAndNotificationCursorsBelongToTheirOwnList() throws Exception {
        UUID challenge = challenge();
        UUID entry = entry(challenge, actor(), 1);
        String otherEntryCursor = java.util.Base64.getUrlEncoder().withoutPadding().encodeToString(
                ("C|" + UUID.randomUUID() + "|2026-10-01T00:00:00Z|" + UUID.randomUUID()).getBytes(java.nio.charset.StandardCharsets.UTF_8));
        assertThat(location(response(get("/v2/entries/{id}/comments", entry).param("cursor", otherEntryCursor), bearer, 422)))
                .isEqualTo("[\"query\",\"cursor\"]");
        assertThat(location(response(get("/v2/me/notifications").param("cursor", "bm90LWEtY3Vyc29y"), bearer, 422)))
                .isEqualTo("[\"query\",\"cursor\"]");
        response(post("/v2/me/notifications/read").content("{\"group_keys\":[\"like:" + entry + "\"]}"), bearer, 204);
        response(post("/v2/me/notifications/read").content("{\"all_before\":{\"created_at\":\"2026-10-01T00:00:00Z\",\"id\":\""
                + UUID.randomUUID() + "\"}}"), bearer, 204);
        assertThat(response(get("/v2/me/notifications/unread-count"), bearer, 200).path("count").asLong()).isZero();
    }

    @Test void adminReportsPageFiftyAtATimeWithACursorForTheirStatus() throws Exception {
        UUID challenge = challenge();
        for (int i = 0; i < 52; i++) {
            jdbc.update("""
                    INSERT INTO entry_reports(id,target_type,target_id,reporter_id,reason,note,status,target_version,target_text,
                                              request_id,request_fingerprint,created_at)
                    VALUES (?,'challenge',?,?,'spam',NULL,'received',1,'쪽 넘기기',?,?,now() - make_interval(mins => ?))
                    """, UUID.randomUUID(), challenge, actor(), UUID.randomUUID(), "0".repeat(64), 100 - i);
        }
        JsonNode first = response(get("/v2/admin/reports"), OPS, 200);
        assertThat(first.path("reports")).hasSize(50);
        assertThat(first.path("reports").get(0).path("open_reports").asLong()).isEqualTo(52);
        JsonNode second = response(get("/v2/admin/reports").param("cursor", first.path("next_cursor").asText()), OPS, 200);
        assertThat(second.path("reports")).hasSize(2);
        assertThat(second.path("next_cursor").isNull()).isTrue();
        assertThat(location(response(get("/v2/admin/reports").param("status", "reviewed").param("cursor", first.path("next_cursor").asText()),
                OPS, 422))).isEqualTo("[\"query\",\"cursor\"]");
        assertThat(location(response(get("/v2/admin/reports").param("cursor", "bm90LWEtY3Vyc29y"), OPS, 422))).isEqualTo("[\"query\",\"cursor\"]");
    }
}
