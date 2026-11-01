package com.acttub.actingapi.feature.billing;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;

import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.UUID;

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
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;

/** ops 구독 화면 경로(SOMA-963): 토큰, 구독 상태별 Pro 판정, 팀 표시, Pro 지급, 출시 주간 인원, 개인정보 미포함. */
@SpringBootTest(properties = {"JWT_SECRET=test-secret", "ADMIN_OPS_TOKEN=admin-secret",
        "ADMIN_OPS_EXCLUDE_EMAILS= Team@Acttub.com ", "ACCOUNT_CLEANUP_ENABLED=false",
        "ACCOUNT_HOUSEKEEPING_ENABLED=false"})
@AutoConfigureMockMvc
@Import(MutableClock.Fixture.class)
class BillingAdminEndpointIT {
    private static final UUID TEAM = UUID.fromString("11111111-1111-4111-8111-111111111111");
    private static final UUID APPLE = UUID.fromString("22222222-2222-4222-8222-222222222222");
    private static final UUID GONE = UUID.fromString("33333333-3333-4333-8333-333333333333");
    private static final UUID GRANTED = UUID.fromString("44444444-4444-4444-8444-444444444444");
    private static final UUID LATE = UUID.fromString("55555555-5555-4555-8555-555555555555");

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        String name = PostgresContainerSupport.createDatabaseName("billing_admin");
        registry.add("spring.datasource.url", () -> PostgresContainerSupport.jdbcUrlFor(name));
        registry.add("spring.datasource.username", PostgresContainerSupport.POSTGRES::getUsername);
        registry.add("spring.datasource.password", PostgresContainerSupport.POSTGRES::getPassword);
    }

    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate jdbc;
    @Autowired ObjectMapper mapper;
    @Autowired MutableClock clock;

    @BeforeEach
    void setUp() {
        jdbc.execute("TRUNCATE TABLE users RESTART IDENTITY CASCADE");
        clock.set(Instant.parse("2026-11-01T06:00:00Z"));
        user(TEAM, "team@acttub.com", "우영", "2026-07-21T02:30:00Z");
        user(APPLE, "relay@privaterelay.appleid.com", null, "2026-11-01T04:17:00Z");
        user(GONE, "gone@example.com", "지난사람", "2026-09-01T00:00:00Z");
        user(GRANTED, "granted@example.com", "이영", "2026-10-10T00:00:00Z");
        user(LATE, "late@example.com", null, "2026-11-01T05:00:00Z");
        jdbc.update("""
                INSERT INTO user_profiles (user_id,name,birth_date,experience,goal,bio)
                VALUES (?,'  홍길동 ','2001-02-03','exam_prep','audition','소개 글')
                """, GRANTED);
        UUID teamSub = sub(TEAM, "canceled", "toss", null, 3900, "2026-10-30T08:16:00Z", "2026-11-30T08:16:00Z",
                "2026-10-30T08:17:00Z");
        jdbc.update("""
                INSERT INTO billing_payments(id,subscription_id,user_id,order_id,kind,amount,status,period_start,period_end)
                VALUES (?,?,?,'order-1','first',3900,'done',?,?)
                """, UUID.randomUUID(), teamSub, TEAM, ts("2026-10-30T08:16:00Z"), ts("2026-11-30T08:16:00Z"));
        sub(APPLE, "active", "apple", "acttub_pro_yearly", 32500, "2026-11-01T04:39:00Z", "2027-11-01T04:39:00Z", null);
        sub(GONE, "expired", "toss", null, 3900, "2026-09-01T00:00:00Z", "2026-10-01T00:00:00Z", null);
        jdbc.update("INSERT INTO billing_pro_grants(id,user_id,starts_at,ends_at,reason) VALUES (?,?,?,?,'인터뷰 감사')",
                UUID.randomUUID(), GRANTED, ts("2026-11-07T15:00:00Z"), ts("2026-12-07T15:00:00Z"));
    }

    @Test
    @DisplayName("구독 장부 전부를 Pro 판정·팀 표시와 함께 싣고, 이메일·user id 는 싣지 않는다")
    void listsSubscribersWithProStateAndTeamFlag() throws Exception {
        MockHttpServletResponse response = mvc.perform(get("/v2/admin/subscribers")
                .param("team_actors", "zzzz, " + actor(GONE).toUpperCase())
                .header("Authorization", "Bearer admin-secret")).andReturn().getResponse();
        assertThat(response.getStatus()).isEqualTo(200);
        assertThat(response.getHeader("Cache-Control")).isEqualTo("private, no-store");
        String body = response.getContentAsString();
        assertThat(body).doesNotContain("@acttub.com", "privaterelay", "example.com", TEAM.toString(),
                APPLE.toString(), "2001-02-03", "소개 글");
        JsonNode root = mapper.readTree(body);
        JsonNode subs = root.path("subscriptions");
        assertThat(subs).hasSize(3);

        JsonNode apple = subs.get(0);
        assertThat(apple.path("actor").textValue()).isEqualTo(actor(APPLE));
        assertThat(apple.path("provider").textValue()).isEqualTo("apple");
        assertThat(apple.path("plan").textValue()).isEqualTo("yearly");
        assertThat(apple.path("pro_now").booleanValue()).isTrue();
        assertThat(apple.path("is_team").booleanValue()).isFalse();
        assertThat(apple.path("name").isNull()).isTrue();

        JsonNode team = subs.get(1);
        assertThat(team.path("nickname").textValue()).isEqualTo("우영");
        assertThat(team.path("is_team").booleanValue()).isTrue();
        assertThat(team.path("status").textValue()).isEqualTo("canceled");
        assertThat(team.path("pro_now").booleanValue()).isTrue();
        assertThat(team.path("paid_amount").longValue()).isEqualTo(3900);
        assertThat(team.path("paid_count").intValue()).isEqualTo(1);
        assertThat(team.path("canceled_at").textValue()).isNotNull();

        JsonNode gone = subs.get(2);
        assertThat(gone.path("pro_now").booleanValue()).isFalse();
        assertThat(gone.path("is_team").booleanValue()).isTrue();

        JsonNode grant = root.path("grants").get(0);
        assertThat(grant.path("name").textValue()).isEqualTo("홍길동");
        assertThat(grant.path("reason").textValue()).isEqualTo("인터뷰 감사");
        assertThat(grant.path("state").textValue()).isEqualTo("scheduled");

        JsonNode launch = root.path("launch_week");
        assertThat(launch.path("active_now").booleanValue()).isTrue();
        assertThat(launch.path("users").intValue()).isEqualTo(3);
        assertThat(launch.path("team_users").intValue()).isEqualTo(2);
    }

    @Test
    @DisplayName("토큰이 없거나 틀리면 401")
    void requiresToken() throws Exception {
        assertThat(mvc.perform(get("/v2/admin/subscribers")).andReturn().getResponse().getStatus()).isEqualTo(401);
        assertThat(mvc.perform(get("/v2/admin/subscribers").header("Authorization", "Bearer nope"))
                .andReturn().getResponse().getStatus()).isEqualTo(401);
    }

    private void user(UUID id, String email, String nickname, String createdAt) {
        jdbc.update("INSERT INTO users(id,status,email,nickname,created_at) VALUES (?,'active',?,?,?)",
                id, email, nickname, ts(createdAt));
    }

    private UUID sub(UUID user, String status, String provider, String product, int amount, String start, String end,
            String canceled) {
        UUID id = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO billing_subscriptions(id,user_id,status,provider,store_product_id,customer_key,amount,
                    current_period_start,current_period_end,canceled_at,created_at)
                VALUES (?,?,?,?,?,?,?,?,?,?,?)
                """, id, user, status, provider, product, "ck-" + id, amount, ts(start), ts(end),
                canceled == null ? null : ts(canceled), ts(start));
        return id;
    }

    private static OffsetDateTime ts(String value) {
        return Instant.parse(value).atOffset(ZoneOffset.UTC);
    }

    private static String actor(UUID id) throws Exception {
        byte[] digest = MessageDigest.getInstance("MD5").digest(id.toString().getBytes(StandardCharsets.UTF_8));
        return String.format("%032x", new BigInteger(1, digest)).substring(0, 8);
    }
}
