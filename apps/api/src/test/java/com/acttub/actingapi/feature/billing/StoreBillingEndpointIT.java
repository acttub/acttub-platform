package com.acttub.actingapi.feature.billing;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Base64;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import com.acttub.actingapi.feature.auth.app.JwtService;
import com.acttub.actingapi.feature.billing.app.BillingRules;
import com.acttub.actingapi.feature.billing.app.StoreGateways.AppleNotification;
import com.acttub.actingapi.feature.billing.app.StoreGateways.AppleStoreGateway;
import com.acttub.actingapi.feature.billing.app.StoreGateways.AppleTransaction;
import com.acttub.actingapi.feature.billing.app.StoreGateways.GoogleStoreGateway;
import com.acttub.actingapi.feature.billing.app.StoreGateways.GoogleSubscription;
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
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

/**
 * 앱 스토어 구독(SOMA-818 2단계)을 실제 Postgres·Spring 으로 본다: 검증 → 구독 줄 upsert, 같은 원거래를 다른 계정이 쓰면 거부,
 * 알림 엔드포인트가 앱 헤더 없이 열리고 푸시 인증을 요구함. Apple·Google 은 가짜 Port 이고 외부 호출은 없다.
 */
@SpringBootTest(properties = {
        "JWT_SECRET=test-secret",
        "ACCOUNT_CLEANUP_ENABLED=false",
        "ACCOUNT_HOUSEKEEPING_ENABLED=false",
        "BILLING_APP_ENABLED=true",
        "BILLING_GOOGLE_PUSH_AUTH=token",
        "BILLING_GOOGLE_PUSH_TOKEN=push-secret",
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
    AppleStoreGateway apple;
    @MockitoBean
    GoogleStoreGateway google;

    private String bearer;
    private String otherBearer;

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
            jdbc.update("INSERT INTO users(id,status) VALUES (?,'active')", id);
            jdbc.update("INSERT INTO user_identities(id,user_id,provider,provider_uid) VALUES (?,?,'google',?)",
                    UUID.randomUUID(), id, "g-" + id);
            AccountFixtures.passGate(jdbc, id);
        }
        bearer = "Bearer " + jwt.issueAccessToken(USER).value();
        otherBearer = "Bearer " + jwt.issueAccessToken(OTHER).value();
        when(apple.configured()).thenReturn(true);
        when(google.configured()).thenReturn(true);
        when(google.packageName()).thenReturn("com.acttub.app");
    }

    private AppleTransaction tx(UUID account, Instant expires) {
        return new AppleTransaction("2000000999", "t1", BillingRules.STORE_PRODUCT_ID, account, clock.instant(), expires, null,
                true, null, false, "Sandbox");
    }

    private JsonNode verify(String token, String body, int status) throws Exception {
        return mapper.readTree(mvc.perform(post("/v2/billing/store/verify").header("Authorization", token)
                        .contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.status().is(status))
                .andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8));
    }

    @Test
    @DisplayName("Apple 검증 → 구독 줄이 apple 로 만들어지고 Pro, 같은 거래는 줄이 늘지 않으며 다른 계정은 409")
    void appleVerifyAndConflict() throws Exception {
        Instant end = clock.instant().plus(Duration.ofDays(30));
        when(apple.verifyTransaction("jws")).thenReturn(tx(USER, end));
        when(apple.latest(anyString(), anyString())).thenReturn(Optional.empty());
        String body = "{\"platform\":\"ios\",\"product_id\":\"acttub_pro_monthly\",\"signed_transaction\":\"jws\"}";
        JsonNode me = verify(bearer, body, 200);
        assertThat(me.path("pro").booleanValue()).isTrue();
        assertThat(me.path("provider").textValue()).isEqualTo("apple");
        verify(bearer, body, 200);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM billing_subscriptions", Integer.class)).isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT store_original_transaction_id FROM billing_subscriptions", String.class))
                .isEqualTo("2000000999");

        when(apple.verifyTransaction("jws")).thenReturn(tx(OTHER, end));
        assertThat(verify(otherBearer, body, 409).path("detail").asText()).contains("store_account_conflict");
        assertThat(jdbc.queryForObject("SELECT count(*) FROM billing_subscriptions", Integer.class)).isEqualTo(1);
    }

    @Test
    @DisplayName("Apple 알림은 앱 헤더 없이 받고 같은 알림을 여러 번 받아도 같은 상태다. 서명이 틀리면 400")
    void appleNotificationEndpoint() throws Exception {
        Instant end = clock.instant().plus(Duration.ofDays(30));
        when(apple.verifyTransaction("jws")).thenReturn(tx(USER, end));
        when(apple.latest(anyString(), anyString())).thenReturn(Optional.empty());
        verify(bearer, "{\"platform\":\"ios\",\"signed_transaction\":\"jws\"}", 200);

        clock.set(clock.instant().plus(Duration.ofDays(1)));
        when(apple.verifyNotification("payload")).thenReturn(new AppleNotification("n1", "DID_CHANGE_RENEWAL_STATUS", "AUTO_RENEW_DISABLED",
                clock.instant(), new AppleTransaction("2000000999", "t1", BillingRules.STORE_PRODUCT_ID, USER, clock.instant(), end,
                        null, false, null, false, "Sandbox")));
        for (int i = 0; i < 3; i++) {
            mvc.perform(post("/v2/billing/store-notify/apple").contentType(MediaType.APPLICATION_JSON)
                    .content("{\"signedPayload\":\"payload\"}"))
                    .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.status().isOk());
        }
        assertThat(jdbc.queryForObject("SELECT status FROM billing_subscriptions", String.class)).isEqualTo("canceled");
        assertThat(jdbc.queryForObject("SELECT count(*) FROM billing_subscriptions", Integer.class)).isEqualTo(1);

        when(apple.verifyNotification("forged")).thenThrow(new com.acttub.actingapi.feature.billing.app.StoreGateways.StoreException(
                com.acttub.actingapi.feature.billing.app.StoreGateways.StoreException.Kind.INVALID, "invalid"));
        mvc.perform(post("/v2/billing/store-notify/apple").contentType(MediaType.APPLICATION_JSON)
                .content("{\"signedPayload\":\"forged\"}"))
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.status().isBadRequest());
    }

    @Test
    @DisplayName("Google 검증 후 RTDN 푸시: 비밀 토큰이 없으면 401, 맞으면 구독을 다시 조회해 상태를 반영한다")
    void googleVerifyAndPush() throws Exception {
        Instant end = clock.instant().plus(Duration.ofDays(30));
        when(google.get("tok-1")).thenReturn(new GoogleSubscription("SUBSCRIPTION_STATE_ACTIVE", BillingRules.STORE_PRODUCT_ID,
                clock.instant(), end, true, USER.toString(), null, false));
        JsonNode me = verify(bearer, "{\"platform\":\"android\",\"purchase_token\":\"tok-1\"}", 200);
        assertThat(me.path("provider").textValue()).isEqualTo("google");

        when(google.get("tok-1")).thenReturn(new GoogleSubscription("SUBSCRIPTION_STATE_CANCELED", BillingRules.STORE_PRODUCT_ID,
                clock.instant(), end, false, USER.toString(), null, true));
        String data = Base64.getEncoder().encodeToString(("{\"packageName\":\"com.acttub.app\",\"subscriptionNotification\":"
                + "{\"notificationType\":3,\"purchaseToken\":\"tok-1\",\"subscriptionId\":\"acttub_pro_monthly\"}}")
                .getBytes(StandardCharsets.UTF_8));
        String body = "{\"message\":{\"data\":\"" + data + "\",\"messageId\":\"1\"},\"subscription\":\"projects/p/subscriptions/s\"}";
        mvc.perform(post("/v2/billing/store-notify/google").contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.status().isUnauthorized());
        mvc.perform(post("/v2/billing/store-notify/google?token=push-secret").contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.status().isOk());
        assertThat(jdbc.queryForObject("SELECT status FROM billing_subscriptions", String.class)).isEqualTo("canceled");
    }
}
