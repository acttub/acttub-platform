package com.acttub.actingapi.feature.push;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.profile.app.ProfileService;
import com.acttub.actingapi.feature.push.app.PushTokenRepository;
import com.acttub.actingapi.support.PostgresContainerSupport;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/**
 * 토큰의 생애 전체 — 등록(upsert)·소유자 교체·세션 주인 조회·해제, 그리고 탈퇴 시 파기.
 *
 * <p>탈퇴 검사가 여기 있는 이유: 파기는 {@code profile} 의 트랜잭션 안에서 일어나지만,
 * 그것이 지키는 약속("탈퇴했는데 알림이 오는 계정은 없다")의 주어는 푸시다.
 */
@SpringBootTest(properties = "JWT_SECRET=test-secret")
class PushTokenLifecycleIT {

    @DynamicPropertySource
    static void datasource(DynamicPropertyRegistry registry) {
        String database = PostgresContainerSupport.createDatabaseName("push_token_lifecycle_it");
        registry.add("spring.datasource.url", () -> PostgresContainerSupport.jdbcUrlFor(database));
        registry.add("spring.datasource.username", PostgresContainerSupport.POSTGRES::getUsername);
        registry.add("spring.datasource.password", PostgresContainerSupport.POSTGRES::getPassword);
    }

    @Autowired
    JdbcTemplate jdbc;

    @Autowired
    PushTokenRepository tokens;

    @Autowired
    ProfileService profiles;

    @Test
    void registerIsIdempotentAndRebindsTheDeviceToItsLatestUser() {
        UUID first = insertUser("push-first@example.com");
        UUID second = insertUser("push-second@example.com");
        String token = "ExponentPushToken[lifecycle]";

        tokens.register(first, token, "ios");
        tokens.register(first, token, "ios");
        assertThat(countTokens(first)).isEqualTo(1);

        // 같은 폰에 다른 계정이 로그인하면 단말의 주인이 바뀐다.
        tokens.register(second, token, "android");
        assertThat(countTokens(first)).isZero();
        assertThat(countTokens(second)).isEqualTo(1);

        tokens.unregister(second, token);
        tokens.unregister(second, token);
        assertThat(countTokens(second)).isZero();
    }

    @Test
    void sessionOwnerLookupFindsEveryDeviceOfTheOwnerOnly() {
        UUID owner = insertUser("push-owner@example.com");
        UUID bystander = insertUser("push-bystander@example.com");
        tokens.register(owner, "ExponentPushToken[owner-phone]", "ios");
        tokens.register(owner, "ExponentPushToken[owner-tablet]", "android");
        tokens.register(bystander, "ExponentPushToken[bystander]", "ios");
        UUID sessionId = insertPracticeSession(owner);

        List<String> found = tokens.tokensForSessionOwner(sessionId);

        assertThat(found).containsExactly(
                "ExponentPushToken[owner-phone]", "ExponentPushToken[owner-tablet]");
        assertThat(tokens.tokensForSessionOwner(UUID.randomUUID())).isEmpty();
    }

    @Test
    void deactivationDestroysEveryPushToken() {
        UUID user = insertUser("push-deactivate@example.com");
        tokens.register(user, "ExponentPushToken[to-destroy]", "ios");

        profiles.deactivate(user);

        assertThat(countTokens(user)).isZero();
    }

    private UUID insertUser(String email) {
        return jdbc.queryForObject("""
                INSERT INTO users (email, nickname, status)
                VALUES (?, 'push-테스트', 'active'::user_status_t)
                RETURNING id
                """, UUID.class, email);
    }

    private UUID insertPracticeSession(UUID userId) {
        UUID intentId = jdbc.queryForObject("""
                INSERT INTO upload_intents
                    (user_id, object_key, mime_type, status, storage_provider,
                     size_bytes, expires_at)
                VALUES (?, 'push-it/' || gen_random_uuid(), 'video/mp4',
                        'finalized'::upload_status_t, 's3', 1024, now() + interval '1 hour')
                RETURNING id
                """, UUID.class, userId);
        return jdbc.queryForObject("""
                INSERT INTO practice_sessions
                    (user_id, upload_intent_id, situation, character_context, goal,
                     blockage_kind, sub_branch)
                VALUES (?, ?, '상황', '인물', '목표', '그 외'::text, '그 외'::text)
                RETURNING id
                """, UUID.class, userId, intentId);
    }

    private int countTokens(UUID userId) {
        Integer count = jdbc.queryForObject(
                "SELECT count(*) FROM push_tokens WHERE user_id = ?", Integer.class, userId);
        return count == null ? 0 : count;
    }
}
