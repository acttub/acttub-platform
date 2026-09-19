package com.acttub.actingapi.feature.profile;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.sql.Timestamp;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.UUID;

import com.acttub.actingapi.feature.profile.app.ProfileService;
import com.acttub.actingapi.support.PostgresContainerSupport;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/**
 * 탈퇴의 파기를 서비스와 실제 Postgres 로 본다. 내 계정 조회와 프로필 저장은 {@code AccountProfileIT} 가 본다.
 */
@SpringBootTest(properties = "JWT_SECRET=test-secret")
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
    JdbcTemplate jdbc;

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

        assertThatThrownBy(() -> profiles.withdraw(USER_ID))
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

        profiles.withdraw(USER_ID);

        var user = jdbc.queryForMap(
                "SELECT email,nickname,status,deactivated_at FROM users WHERE id=?", USER_ID);
        assertThat(user)
                .containsEntry("email", null)
                .containsEntry("nickname", null)
                .containsEntry("status", "deactivated");
        assertThat(((Timestamp) user.get("deactivated_at")).toInstant())
                .isEqualTo(firstDeactivatedAt);
        assertThat(profileName()).isNull();
        // 신원 행은 지우지 않는다 — 제공자 ID 를 비우고 해시만 남긴다 (ADR-029).
        assertThat(jdbc.queryForMap("SELECT provider_uid,uid_hash FROM user_identities WHERE user_id=?", USER_ID))
                .containsEntry("provider_uid", null)
                .extractingByKey("uid_hash").asString().matches("[dk]1:[0-9a-f]{64}");
        assertThat(jdbc.queryForObject(
                "SELECT count(*) FROM refresh_tokens WHERE revoked_at IS NULL", Integer.class))
                .isZero();
        assertThat(count("push_tokens")).isZero();
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

        profiles.withdraw(USER_ID);

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

        profiles.withdraw(USER_ID);

        assertThat(count("community_posts")).isEqualTo(1);
        assertThat(count("community_comments")).isEqualTo(1);
        assertThat(count("community_blocks")).isEqualTo(1);
    }

    private String profileName() {
        return jdbc.queryForObject("SELECT name FROM user_profiles WHERE user_id=?", String.class, USER_ID);
    }

    private int count(String table) {
        Integer count = jdbc.queryForObject("SELECT count(*) FROM " + table, Integer.class);
        return count == null ? 0 : count;
    }
}
