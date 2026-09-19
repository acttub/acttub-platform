package com.acttub.actingapi.feature.profile;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;

import java.sql.Timestamp;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.UUID;

import com.acttub.actingapi.feature.auth.app.JwtService;
import com.acttub.actingapi.feature.profile.app.ProfileService;
import com.acttub.actingapi.support.PostgresContainerSupport;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.dao.DataAccessException;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest(properties = "JWT_SECRET=test-secret")
@AutoConfigureMockMvc
class ProfileEndpointIT {
    private static final UUID USER_ID =
            UUID.fromString("00000000-0000-4000-8000-000000000101");

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        String name = PostgresContainerSupport.createDatabaseName("profile_endpoint");
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
    ObjectMapper mapper;

    @Autowired
    ProfileService profiles;

    @BeforeEach
    void setUp() {
        jdbc.execute("DROP TRIGGER IF EXISTS fail_push_delete ON push_tokens");
        jdbc.execute("DROP FUNCTION IF EXISTS fail_push_delete()");
        jdbc.execute("TRUNCATE TABLE users RESTART IDENTITY CASCADE");
        jdbc.update(
                "INSERT INTO users(id,email,nickname,status) VALUES (?,?,NULL,'active')",
                USER_ID,
                null);
    }

    @Test
    void deactivationRollsBackEveryCredentialCleanupWhenTheLastStepFails() {
        jdbc.update(
                "UPDATE users SET email='rollback@example.test',nickname='되돌릴 이름' WHERE id=?",
                USER_ID);
        jdbc.update("INSERT INTO user_profiles(user_id,name) VALUES (?,'되돌릴 이름')", USER_ID);
        jdbc.update("""
                INSERT INTO user_identities(id,user_id,provider,provider_uid)
                VALUES (?,?, 'development','rollback-identity')
                """, UUID.randomUUID(), USER_ID);
        jdbc.update("""
                INSERT INTO refresh_tokens(id,user_id,token_hash,expires_at)
                VALUES (?,?,?,now() + interval '1 day')
                """, UUID.randomUUID(), USER_ID, "a".repeat(64));
        jdbc.update("""
                INSERT INTO push_tokens(user_id,token,platform)
                VALUES (?,'ExponentPushToken[rollback]','ios')
                """, USER_ID);
        jdbc.execute("""
                CREATE FUNCTION fail_push_delete() RETURNS trigger AS $$
                BEGIN
                    RAISE EXCEPTION 'forced push cleanup failure';
                END
                $$ LANGUAGE plpgsql
                """);
        jdbc.execute("""
                CREATE TRIGGER fail_push_delete
                BEFORE DELETE ON push_tokens
                FOR EACH ROW EXECUTE FUNCTION fail_push_delete()
                """);

        assertThatThrownBy(() -> profiles.deactivate(USER_ID))
                .isInstanceOf(DataAccessException.class)
                .hasStackTraceContaining("forced push cleanup failure");

        assertThat(jdbc.queryForMap(
                "SELECT email,nickname,status,deactivated_at FROM users WHERE id=?", USER_ID))
                .containsEntry("email", "rollback@example.test")
                .containsEntry("nickname", "되돌릴 이름")
                .containsEntry("status", "active")
                .containsEntry("deactivated_at", null);
        assertThat(profileName()).isEqualTo("되돌릴 이름");
        assertThat(count("user_identities")).isEqualTo(1);
        assertThat(jdbc.queryForObject(
                "SELECT count(*) FROM refresh_tokens WHERE revoked_at IS NULL", Integer.class))
                .isEqualTo(1);
        assertThat(count("push_tokens")).isEqualTo(1);
    }

    @Test
    void deactivationRetryKeepsTheFirstTimestampAndFinishesCredentialCleanup() {
        Instant firstDeactivatedAt = Instant.parse("2026-08-01T00:00:00Z");
        jdbc.update("""
                UPDATE users
                SET email='retry@example.test',nickname='재시도',status='deactivated',
                    deactivated_at=?
                WHERE id=?
                """, firstDeactivatedAt.atOffset(ZoneOffset.UTC), USER_ID);
        jdbc.update("INSERT INTO user_profiles(user_id,name) VALUES (?,'재시도')", USER_ID);
        jdbc.update("""
                INSERT INTO user_identities(id,user_id,provider,provider_uid)
                VALUES (?,?, 'development','retry-identity')
                """, UUID.randomUUID(), USER_ID);
        jdbc.update("""
                INSERT INTO refresh_tokens(id,user_id,token_hash,expires_at)
                VALUES (?,?,?,now() + interval '1 day')
                """, UUID.randomUUID(), USER_ID, "c".repeat(64));
        jdbc.update("""
                INSERT INTO push_tokens(user_id,token,platform)
                VALUES (?,'ExponentPushToken[retry]','ios')
                """, USER_ID);

        profiles.deactivate(USER_ID);

        var user = jdbc.queryForMap(
                "SELECT email,nickname,status,deactivated_at FROM users WHERE id=?", USER_ID);
        assertThat(user)
                .containsEntry("email", null)
                .containsEntry("nickname", null)
                .containsEntry("status", "deactivated");
        assertThat(((Timestamp) user.get("deactivated_at")).toInstant())
                .isEqualTo(firstDeactivatedAt);
        assertThat(profileName()).isNull();
        assertThat(count("user_identities")).isZero();
        assertThat(jdbc.queryForObject(
                "SELECT count(*) FROM refresh_tokens WHERE revoked_at IS NULL", Integer.class))
                .isZero();
        assertThat(count("push_tokens")).isZero();
    }

    @Test
    void profileKeepsRequiredNullsAndCollapsesInternalNicknameWhitespace() throws Exception {
        JsonNode before = body(mvc.perform(get("/v2/me").header("Authorization", bearer()))
                .andReturn().getResponse().getContentAsString());
        assertThat(before).isEqualTo(mapper.readTree("""
                {
                  "id":"00000000-0000-4000-8000-000000000101",
                  "email":null,
                  "nickname":null,
                  "status":"active"
                }
                """));

        var response = mvc.perform(patch("/v2/me")
                        .header("Authorization", bearer())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"nickname\":\"  두   칸   띄운   이름  \"}"))
                .andReturn().getResponse();

        assertThat(response.getStatus()).isEqualTo(200);
        assertThat(body(response.getContentAsString()).path("nickname").textValue())
                .isEqualTo("두 칸 띄운 이름");
        assertThat(profileName()).isEqualTo("두 칸 띄운 이름");
        assertThat(jdbc.queryForObject(
                "SELECT nickname FROM users WHERE id=?", String.class, USER_ID))
                .as("이름은 user_profiles.name 에만 쓴다 — 옛 컬럼은 건드리지 않는다")
                .isNull();
    }

    /**
     * V7 은 옛 닉네임을 {@code user_profiles.name} 으로 복사하고 {@code users.nickname} 은 직전
     * 릴리스의 서버를 위해 남겨 둔다. 새 서버가 읽는 것은 프로필의 이름뿐이다.
     */
    @Test
    void accountProfile_nameIsReadFromTheProfileRowNotFromTheLegacyNicknameColumn() throws Exception {
        jdbc.update("UPDATE users SET nickname='옛 컬럼 값' WHERE id=?", USER_ID);

        assertThat(body(mvc.perform(get("/v2/me").header("Authorization", bearer()))
                .andReturn().getResponse().getContentAsString()).path("nickname").isNull())
                .as("프로필 행이 없으면 옛 컬럼에 값이 있어도 이름은 비어 있다")
                .isTrue();

        jdbc.update("INSERT INTO user_profiles(user_id,name) VALUES (?,'프로필 이름')", USER_ID);

        assertThat(body(mvc.perform(get("/v2/me").header("Authorization", bearer()))
                .andReturn().getResponse().getContentAsString()).path("nickname").textValue())
                .isEqualTo("프로필 이름");
    }

    /**
     * 1.0.0 이전 회원은 이름이 두 곳에 있다(옛 컬럼과 복사된 프로필 이름). 탈퇴는 이름을 지체 없이
     * 파기해야 하므로 둘 다 비운다 — 새 코드가 {@code users.nickname} 을 건드리는 유일한 자리다
     * (SOMA-528 결정 I-3). 프로필 행과 나머지 항목은 사람과 끊어 남긴다.
     */
    @Test
    void accountWithdraw_clearsBothTheLegacyNicknameAndTheProfileName() {
        jdbc.update("UPDATE users SET email='old@example.test',nickname='옛 닉네임' WHERE id=?", USER_ID);
        jdbc.update("""
                INSERT INTO user_profiles(user_id,name,gender,experience,goal)
                VALUES (?,'옛 닉네임','female','exam_prep','audition')
                """, USER_ID);

        profiles.deactivate(USER_ID);

        assertThat(jdbc.queryForMap("SELECT email,nickname,status FROM users WHERE id=?", USER_ID))
                .containsEntry("email", null)
                .containsEntry("nickname", null)
                .containsEntry("status", "deactivated");
        assertThat(jdbc.queryForMap(
                "SELECT name,gender,experience,goal FROM user_profiles WHERE user_id=?", USER_ID))
                .containsEntry("name", null)
                .containsEntry("gender", "female")
                .containsEntry("experience", "exam_prep")
                .containsEntry("goal", "audition");
    }

    /** 커뮤니티는 API 만 내렸다. 탈퇴해도 글·댓글·차단 행은 남아 남의 글타래가 깨지지 않는다. */
    @Test
    void accountWithdraw_keepsRetiredCommunityRows() {
        UUID other = UUID.randomUUID();
        UUID post = UUID.randomUUID();
        jdbc.update("INSERT INTO users(id,status) VALUES (?,'active')", other);
        jdbc.update("""
                INSERT INTO community_posts(id,category_id,author_id,title,body)
                SELECT ?,id,?,'제목','본문' FROM community_categories ORDER BY sort_order LIMIT 1
                """, post, USER_ID);
        jdbc.update("INSERT INTO community_comments(id,post_id,author_id,body) VALUES (?,?,?,'댓글')",
                UUID.randomUUID(), post, USER_ID);
        jdbc.update("INSERT INTO community_blocks(id,blocker_id,blocked_id) VALUES (?,?,?)",
                UUID.randomUUID(), USER_ID, other);

        profiles.deactivate(USER_ID);

        assertThat(count("community_posts")).isEqualTo(1);
        assertThat(count("community_comments")).isEqualTo(1);
        assertThat(count("community_blocks")).isEqualTo(1);
    }

    @Test
    void blankNicknamePreservesPydanticValueErrorMessageAndContext() throws Exception {
        var response = mvc.perform(patch("/v2/me")
                        .header("Authorization", bearer())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"nickname\":\"   \"}"))
                .andReturn().getResponse();

        assertThat(response.getStatus()).isEqualTo(422);
        assertThat(body(response.getContentAsString())).isEqualTo(mapper.readTree("""
                {"detail":[{
                  "type":"value_error",
                  "loc":["body","nickname"],
                  "msg":"Value error, nickname must not be blank",
                  "input":"   ",
                  "ctx":{"error":{}}
                }]}
                """));
    }

    @Test
    void profileRequestRejectsUnknownKeys() throws Exception {
        var response = mvc.perform(patch("/v2/me")
                        .header("Authorization", bearer())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"nickname\":\"이름\",\"unknown\":1}"))
                .andReturn().getResponse();

        assertThat(response.getStatus()).isEqualTo(422);
        assertThat(body(response.getContentAsString()).path("detail").get(0).path("type").textValue())
                .isEqualTo("extra_forbidden");
    }

    @Test
    void nicknameLengthCountsUnicodeCodePointsLikePydantic() throws Exception {
        String twentyEmoji = "😀".repeat(20);
        var accepted = mvc.perform(patch("/v2/me")
                        .header("Authorization", bearer())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(mapper.writeValueAsString(java.util.Map.of("nickname", twentyEmoji))))
                .andReturn().getResponse();
        assertThat(accepted.getStatus()).isEqualTo(200);

        var rejected = mvc.perform(patch("/v2/me")
                        .header("Authorization", bearer())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(mapper.writeValueAsString(
                                java.util.Map.of("nickname", "가".repeat(21)))))
                .andReturn().getResponse();
        assertThat(rejected.getStatus()).isEqualTo(422);
        JsonNode error = body(rejected.getContentAsString()).path("detail").get(0);
        assertThat(error.path("type").textValue()).isEqualTo("string_too_long");
        assertThat(error.path("ctx").path("max_length").intValue()).isEqualTo(20);
    }

    private String bearer() {
        return "Bearer " + jwt.issueAccessToken(USER_ID).value();
    }

    private JsonNode body(String value) throws Exception {
        return mapper.readTree(value);
    }

    private String profileName() {
        return jdbc.queryForObject("SELECT name FROM user_profiles WHERE user_id=?", String.class, USER_ID);
    }

    private int count(String table) {
        Integer count = jdbc.queryForObject("SELECT count(*) FROM " + table, Integer.class);
        return count == null ? 0 : count;
    }
}
