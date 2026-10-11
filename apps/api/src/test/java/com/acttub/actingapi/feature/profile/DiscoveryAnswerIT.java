package com.acttub.actingapi.feature.profile;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.HexFormat;
import java.util.Map;
import java.util.UUID;

import com.acttub.actingapi.feature.auth.app.JwtService;
import com.acttub.actingapi.feature.profile.app.ProfileService;
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
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;

/**
 * 가입 직후 유입 경로 자기 응답(SOMA-649) — {@code PUT /v2/me/discovery} 를 HTTP 와 실제 Postgres 로 본다.
 * 처음 답만 남는지, 건너뜀이 남는지, 값·조합 규칙이 422 로 막히는지, 탈퇴가 지우는지, ops-core 에 무엇이 실리는지.
 */
@SpringBootTest(properties = {
    "JWT_SECRET=test-secret",
    "ACCOUNT_CLEANUP_ENABLED=false",
    "ADMIN_OPS_TOKEN=admin-secret",
    "ADMIN_OPS_EXCLUDE_EMAILS=team@acttub.com"
})
@AutoConfigureMockMvc
class DiscoveryAnswerIT {

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        String name = PostgresContainerSupport.createDatabaseName("discovery_answer");
        registry.add("spring.datasource.url", () -> PostgresContainerSupport.jdbcUrlFor(name));
        registry.add("spring.datasource.username", PostgresContainerSupport.POSTGRES::getUsername);
        registry.add("spring.datasource.password", PostgresContainerSupport.POSTGRES::getPassword);
    }

    @Autowired
    MockMvc mvc;

    @Autowired
    JdbcTemplate jdbc;

    @Autowired
    JwtService jwt;

    @Autowired
    ProfileService profiles;

    @Autowired
    ObjectMapper mapper;

    private UUID member;
    private String bearer;

    @BeforeEach
    void setUp() {
        jdbc.execute("TRUNCATE TABLE users,consent_documents RESTART IDENTITY CASCADE");
        OffsetDateTime publishedAt = OffsetDateTime.of(2026, 10, 1, 0, 0, 0, 0, ZoneOffset.UTC);
        jdbc.update("""
                INSERT INTO consent_documents(id,type,version,title,body,required,published_at)
                VALUES (?,'terms','v1','약관','본문',true,?)
                """, UUID.randomUUID(), publishedAt);
        jdbc.update("""
                INSERT INTO consent_documents(id,type,version,title,body,required,published_at)
                VALUES (?,'privacy','v1','개인정보 수집·이용','본문',true,?)
                """, UUID.randomUUID(), publishedAt);
        member = UUID.randomUUID();
        jdbc.update("INSERT INTO users(id,status) VALUES (?,'active')", member);
        jdbc.update("INSERT INTO user_identities(id,user_id,provider,provider_uid) VALUES (?,?,'google',?)",
                UUID.randomUUID(), member, "g-" + member);
        AccountFixtures.passGate(jdbc, member);
        bearer = "Bearer " + jwt.issueAccessToken(member).value();
    }

    @Test
    @DisplayName("처음 답만 남는다 — 다시 보내도 204 이고 첫 답이 그대로다")
    void firstAnswerWinsAndRetriesAreHarmless() throws Exception {
        assertThat(answer("{\"source\":\"instagram\",\"detail\":\"ad\"}").getStatus()).isEqualTo(204);
        assertThat(answer("{\"source\":\"friend\"}").getStatus()).isEqualTo(204);

        Map<String, Object> row = jdbc.queryForMap(
                "SELECT source,detail,other_text FROM user_discovery_answers WHERE user_id=?", member);
        assertThat(row)
                .containsEntry("source", "instagram")
                .containsEntry("detail", "ad")
                .containsEntry("other_text", null);
    }

    @Test
    @DisplayName("건너뛰면 source 가 NULL 인 행이 남고, 기타의 직접 입력은 앞뒤 공백을 걷어 적는다")
    void skipIsRecordedAndOtherTextIsTrimmed() throws Exception {
        assertThat(answer("{\"source\":null}").getStatus()).isEqualTo(204);
        assertThat(jdbc.queryForMap("SELECT source,detail FROM user_discovery_answers WHERE user_id=?", member))
                .containsEntry("source", null)
                .containsEntry("detail", null);

        UUID other = gatedMember();
        assertThat(answer("{\"source\":\"other\",\"other_text\":\"  학원 선생님  \"}", tokenOf(other)).getStatus())
                .isEqualTo(204);
        assertThat(jdbc.queryForObject(
                "SELECT other_text FROM user_discovery_answers WHERE user_id=?", String.class, other))
                .isEqualTo("학원 선생님");
    }

    @Test
    @DisplayName("모르는 값·맞지 않는 조합·30자 초과·모르는 키는 422 이고 아무것도 적지 않는다")
    void invalidAnswersAreRejected() throws Exception {
        assertThat(answer("{\"source\":\"tiktok\"}").getStatus()).isEqualTo(422);
        assertThat(answer("{\"source\":\"friend\",\"detail\":\"ad\"}").getStatus()).isEqualTo(422);
        assertThat(answer("{\"source\":\"instagram\",\"detail\":\"story\"}").getStatus()).isEqualTo(422);
        assertThat(answer("{\"source\":\"friend\",\"other_text\":\"누구\"}").getStatus()).isEqualTo(422);
        assertThat(answer("{\"source\":\"other\",\"other_text\":\"%s\"}".formatted("가".repeat(31))).getStatus())
                .isEqualTo(422);
        assertThat(answer("{\"source\":\"friend\",\"email\":\"x@example.com\"}").getStatus()).isEqualTo(422);

        assertThat(count(member)).isZero();
    }

    @Test
    @DisplayName("DB도 값 목록과 조합을 거절한다")
    void databaseRejectsInvalidValues() {
        assertThatThrownBy(() -> jdbc.update(
                "INSERT INTO user_discovery_answers(user_id,source) VALUES (?,'tiktok')", member))
                .hasMessageContaining("ck_user_discovery_answers_source");
        assertThatThrownBy(() -> jdbc.update(
                "INSERT INTO user_discovery_answers(user_id,source,detail) VALUES (?,'friend','ad')", member))
                .hasMessageContaining("ck_user_discovery_answers_detail_source");
        assertThatThrownBy(() -> jdbc.update(
                "INSERT INTO user_discovery_answers(user_id,source,other_text) VALUES (?,'friend','x')", member))
                .hasMessageContaining("ck_user_discovery_answers_other_text");
        assertThat(count(member)).isZero();
    }

    @Test
    @DisplayName("게스트는 403 이고 적지 않는다")
    void guestsCannotAnswer() throws Exception {
        UUID guest = UUID.randomUUID();
        jdbc.update("INSERT INTO users(id,status) VALUES (?,'active')", guest);
        jdbc.update("INSERT INTO user_identities(id,user_id,provider,provider_uid) VALUES (?,?,'guest',?)",
                UUID.randomUUID(), guest, "guest-" + guest);

        assertThat(answer("{\"source\":\"friend\"}", tokenOf(guest)).getStatus()).isEqualTo(403);
        assertThat(count(guest)).isZero();
    }

    @Test
    @DisplayName("탈퇴하면 답을 행째 지우고, 탈퇴한 계정에는 다시 적지 않는다")
    void withdrawalErasesTheAnswer() throws Exception {
        assertThat(answer("{\"source\":\"other\",\"other_text\":\"유튜브 쇼츠\"}").getStatus()).isEqualTo(204);

        profiles.withdraw(member);

        assertThat(count(member)).isZero();
        assertThat(answer("{\"source\":\"friend\"}").getStatus()).isEqualTo(403);
        assertThat(count(member)).isZero();
    }

    @Test
    @DisplayName("ops-core 가입 원장에는 값 이름만 싣고 기타의 직접 입력은 싣지 않는다")
    void opsCoreCarriesValueNamesButNotFreeText() throws Exception {
        assertThat(answer("{\"source\":\"other\",\"other_text\":\"비밀 메모\"}").getStatus()).isEqualTo(204);

        var response = mvc.perform(get("/v2/admin/ops-core").header("Authorization", "Bearer admin-secret"))
                .andReturn().getResponse();
        assertThat(response.getStatus()).isEqualTo(200);
        String body = response.getContentAsString();
        assertThat(body).doesNotContain("비밀 메모");
        JsonNode rows = mapper.readTree(body).path("signup_rows");
        JsonNode row = null;
        for (JsonNode candidate : rows) {
            if (candidate.path("actor").asText().equals("배우 " + md5(member.toString()).substring(0, 8))) {
                row = candidate;
            }
        }
        assertThat(row).isNotNull();
        assertThat(row.path("discovery_answered").booleanValue()).isTrue();
        assertThat(row.path("discovery_source").asText()).isEqualTo("other");
        assertThat(row.path("discovery_detail").isNull()).isTrue();
    }

    private UUID gatedMember() {
        UUID userId = UUID.randomUUID();
        jdbc.update("INSERT INTO users(id,status) VALUES (?,'active')", userId);
        jdbc.update("INSERT INTO user_identities(id,user_id,provider,provider_uid) VALUES (?,?,'google',?)",
                UUID.randomUUID(), userId, "g-" + userId);
        AccountFixtures.passGate(jdbc, userId);
        return userId;
    }

    private String tokenOf(UUID userId) {
        return "Bearer " + jwt.issueAccessToken(userId).value();
    }

    private static String md5(String value) throws Exception {
        return HexFormat.of().formatHex(
                MessageDigest.getInstance("MD5").digest(value.getBytes(StandardCharsets.UTF_8)));
    }

    private MockHttpServletResponse answer(String body) throws Exception {
        return answer(body, bearer);
    }

    private MockHttpServletResponse answer(String body, String authorization) throws Exception {
        return mvc.perform(put("/v2/me/discovery")
                        .header("Authorization", authorization)
                        .header("X-Acttub-Client", "app/0.1.2")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andReturn().getResponse();
    }

    private int count(UUID userId) {
        Integer count = jdbc.queryForObject(
                "SELECT count(*) FROM user_discovery_answers WHERE user_id=?", Integer.class, userId);
        return count == null ? 0 : count;
    }
}
