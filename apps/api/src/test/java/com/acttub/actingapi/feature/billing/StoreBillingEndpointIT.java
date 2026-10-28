package com.acttub.actingapi.feature.billing;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import com.acttub.actingapi.feature.auth.app.JwtService;
import com.acttub.actingapi.feature.billing.app.StoreGateways.RevenueCatGateway;
import com.acttub.actingapi.feature.billing.app.StoreGateways.StoreSubscription;
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
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

/**
 * 앱 스토어 구독(SOMA-818 2단계, RevenueCat)을 실제 Postgres·Spring 으로 본다: 동기화 → 구독 줄 upsert(멱등), 웹훅이 앱 헤더 없이
 * 열리고 Authorization 헤더를 요구하며 RevenueCat 을 다시 읽어 상태를 반영함, 토스 줄·탈퇴한 사람은 덮지 않음. RevenueCat 은 가짜
 * Port 이고 외부 호출은 없다.
 */
@SpringBootTest(properties = {
        "JWT_SECRET=test-secret",
        "ACCOUNT_CLEANUP_ENABLED=false",
        "ACCOUNT_HOUSEKEEPING_ENABLED=false",
        "BILLING_APP_ENABLED=true",
        "REVENUECAT_WEBHOOK_AUTH=Bearer rc-secret",
        "BILLING_RENEWAL_POLL_MS=3600000",
        "BILLING_RENEWAL_INITIAL_DELAY_MS=3600000"})
@AutoConfigureMockMvc
@Import(MutableClock.Fixture.class)
class StoreBillingEndpointIT {
    static final UUID USER = UUID.fromString("44444444-4444-4444-8444-444444444444");
    static final UUID OTHER = UUID.fromString("55555555-5555-4555-8555-555555555555");
    private static final OffsetDateTime PUBLISHED = OffsetDateTime.of(2026, 10, 1, 0, 0, 0, 0, ZoneOffset.UTC);

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        String name = PostgresContainerSupport.createDatabaseName("billing_store");
        registry.add("spring.datasource.url", () -> PostgresContainerSupport.jdbcUrlFor(name));
        registry.add("spring.datasource.username", PostgresContainerSupport.POSTGRES::getUsername);
        registry.add("spring.datasource.password", PostgresContainerSupport.POSTGRES::getPassword);
    }

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

    @MockitoBean
    RevenueCatGateway revenueCat;

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
        clock.set(Instant.parse("2026-11-03T01:00:00Z"));
        for (UUID id : List.of(USER, OTHER)) {
            // 가입 시각을 시계(11/3)에 맞춘다 — 11/1 전 가입이면 출시 주간 Pro(SOMA-899)가 붙어 구독 판정 시험이 흐려진다.
            jdbc.update("INSERT INTO users(id,status,created_at) VALUES (?,'active',?)", id, java.sql.Timestamp.from(clock.instant()));
            jdbc.update("INSERT INTO user_identities(id,user_id,provider,provider_uid) VALUES (?,?,'google',?)",
                    UUID.randomUUID(), id, "g-" + id);
            AccountFixtures.passGate(jdbc, id);
        }
        bearer = "Bearer " + jwt.issueAccessToken(USER).value();
        when(revenueCat.configured()).thenReturn(true);
        when(revenueCat.entitlement(org.mockito.ArgumentMatchers.anyString())).thenReturn(Optional.empty());
    }

    private StoreSubscription sub(String store, String product, Instant expires, Instant unsubscribed) {
        return new StoreSubscription(store, product, clock.instant(), expires, null, unsubscribed, null, null, false, "2000000999");
    }

    private JsonNode sync(int expected) throws Exception {
        return mapper.readTree(mvc.perform(post("/v2/billing/store/sync").header("Authorization", bearer))
                .andExpect(status().is(expected))
                .andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8));
    }

    private void webhook(String auth, String type, UUID who, int expected) throws Exception {
        var request = post("/v2/billing/store-notify/revenuecat").contentType(MediaType.APPLICATION_JSON)
                .content("{\"api_version\":\"1.0\",\"event\":{\"id\":\"evt-1\",\"type\":\"" + type + "\",\"app_user_id\":\""
                        + who + "\",\"original_app_user_id\":\"" + who + "\",\"aliases\":[\"" + who + "\"]}}");
        if (auth != null) {
            request.header("Authorization", auth);
        }
        mvc.perform(request).andExpect(status().is(expected));
    }

    @Test
    @DisplayName("동기화 → 구독 줄이 apple 로 만들어지고 Pro, 다시 동기화해도 줄은 하나다")
    void syncCreatesOneRow() throws Exception {
        Instant end = clock.instant().plus(Duration.ofDays(30));
        when(revenueCat.entitlement(USER.toString())).thenReturn(Optional.of(sub("app_store", "acttub_pro_monthly", end, null)));
        JsonNode me = sync(200);
        assertThat(me.path("pro").booleanValue()).isTrue();
        assertThat(me.path("provider").textValue()).isEqualTo("apple");
        assertThat(me.path("status").textValue()).isEqualTo("active");
        sync(200);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM billing_subscriptions", Integer.class)).isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT store_transaction_id FROM billing_subscriptions", String.class)).isEqualTo("2000000999");
        assertThat(jdbc.queryForObject("SELECT amount FROM billing_subscriptions", Integer.class)).isEqualTo(3900);
    }

    @Test
    @DisplayName("웹훅은 Authorization 이 맞아야 하고(앱 헤더 없이), RevenueCat 을 다시 읽어 상태를 쓰며 여러 번 와도 같다")
    void webhookAuthAndIdempotency() throws Exception {
        Instant end = clock.instant().plus(Duration.ofDays(30));
        when(revenueCat.entitlement(USER.toString())).thenReturn(Optional.of(sub("play_store", "acttub_pro_yearly", end, null)));
        webhook(null, "INITIAL_PURCHASE", USER, 401);
        webhook("Bearer wrong", "INITIAL_PURCHASE", USER, 401);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM billing_subscriptions", Integer.class)).isZero();

        webhook("Bearer rc-secret", "INITIAL_PURCHASE", USER, 200);
        assertThat(jdbc.queryForObject("SELECT provider FROM billing_subscriptions", String.class)).isEqualTo("google");
        assertThat(jdbc.queryForObject("SELECT amount FROM billing_subscriptions", Integer.class)).isEqualTo(32500);

        clock.set(clock.instant().plus(Duration.ofDays(1)));
        when(revenueCat.entitlement(USER.toString())).thenReturn(Optional.of(sub("play_store", "acttub_pro_yearly", end,
                clock.instant())));
        for (int i = 0; i < 3; i++) {
            webhook("Bearer rc-secret", "CANCELLATION", USER, 200);
        }
        assertThat(jdbc.queryForObject("SELECT status FROM billing_subscriptions", String.class)).isEqualTo("canceled");
        assertThat(jdbc.queryForObject("SELECT count(*) FROM billing_subscriptions", Integer.class)).isEqualTo(1);

        // 이 사람의 entitlement 가 없어지면(다른 계정으로 옮겨짐) 스토어 줄을 끝낸다.
        when(revenueCat.entitlement(USER.toString())).thenReturn(Optional.empty());
        webhook("Bearer rc-secret", "TRANSFER", USER, 200);
        assertThat(jdbc.queryForObject("SELECT status FROM billing_subscriptions", String.class)).isEqualTo("expired");
    }

    @Test
    @DisplayName("토스로 이용 중인 사람은 동기화가 409 이고 토스 줄은 그대로다. 탈퇴한 사람의 웹훅은 줄을 만들지 않는다")
    void tossAndWithdrawnUsersAreNotOverwritten() throws Exception {
        jdbc.update("""
                INSERT INTO billing_subscriptions(id,user_id,status,provider,customer_key,amount,current_period_start,current_period_end)
                VALUES (?,?,'active','toss','ck-1',3900,now(),now() + interval '20 days')
                """, UUID.randomUUID(), USER);
        when(revenueCat.entitlement(USER.toString())).thenReturn(Optional.of(sub("app_store", "acttub_pro_monthly",
                clock.instant().plus(Duration.ofDays(30)), null)));
        assertThat(sync(409).path("detail").asText()).contains("already_subscribed");
        assertThat(jdbc.queryForObject("SELECT provider FROM billing_subscriptions", String.class)).isEqualTo("toss");

        jdbc.update("UPDATE users SET status='deactivated' WHERE id=?", OTHER);
        when(revenueCat.entitlement(OTHER.toString())).thenReturn(Optional.of(sub("app_store", "acttub_pro_monthly",
                clock.instant().plus(Duration.ofDays(30)), null)));
        webhook("Bearer rc-secret", "RENEWAL", OTHER, 200);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM billing_subscriptions WHERE user_id=?", Integer.class, OTHER)).isZero();
    }
}
