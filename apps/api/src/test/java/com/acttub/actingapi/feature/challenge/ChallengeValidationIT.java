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

/** 챌린지 HTTP 의 값 검사: 모르는 정렬·탭·공개 범위·신고 대상·처리 상태는 저장소에 닿기 전에 422 배열로 거절한다. */
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

    @BeforeEach void member() {
        jdbc.execute("TRUNCATE users,challenges RESTART IDENTITY CASCADE");
        UUID user = UUID.randomUUID();
        jdbc.update("INSERT INTO users(id,status) VALUES (?,'active')", user);
        jdbc.update("INSERT INTO user_identities(id,user_id,provider,provider_uid) VALUES (?,?,'google',?)",
                UUID.randomUUID(), user, user.toString());
        AccountFixtures.passGate(jdbc, user);
        bearer = "Bearer " + jwt.issueAccessToken(user).value();
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
}
