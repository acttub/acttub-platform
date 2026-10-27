package com.acttub.actingapi.feature.billing.adapter.store;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

import com.acttub.actingapi.feature.billing.app.StoreGateways.StoreException;
import com.acttub.actingapi.feature.billing.app.StoreGateways.StoreSubscription;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** RevenueCat REST v1 고객 정보 → 구독 값(SOMA-818 2단계). 가짜 HTTP 서버로 요청 모양과 응답 해석을 본다. */
class RevenueCatGatewayImplTest {
    static final ObjectMapper JSON = new ObjectMapper();
    /** 공식 Customer Info 모델의 예시 모양을 우리 상품으로 바꾼 것. */
    static final String CUSTOMER = """
            {"request_date":"2026-11-03T01:00:00Z","request_date_ms":1793667600000,
             "subscriber":{
               "entitlements":{"pro":{"expires_date":"2026-12-03T01:00:00Z","grace_period_expires_date":null,
                 "product_identifier":"acttub_pro_monthly","purchase_date":"2026-11-03T01:00:00Z"}},
               "first_seen":"2026-11-01T00:00:00Z","management_url":"https://apps.apple.com/account/subscriptions",
               "non_subscriptions":{},"original_app_user_id":"u","other_purchases":{},
               "subscriptions":{
                 "acttub_pro_monthly":{"auto_resume_date":null,"billing_issues_detected_at":null,
                   "expires_date":"2026-12-03T01:00:00Z","grace_period_expires_date":null,"is_sandbox":true,
                   "original_purchase_date":"2026-11-03T01:00:00Z","ownership_type":"PURCHASED","period_type":"normal",
                   "purchase_date":"2026-11-03T01:00:00Z","refunded_at":null,"store":"app_store",
                   "store_transaction_id":"2000000123","unsubscribe_detected_at":"2026-11-04T02:00:00Z"},
                 "old_product":{"store":"play_store","expires_date":"2020-01-01T00:00:00Z"}}}}
            """;

    HttpServer server;
    final AtomicInteger status = new AtomicInteger(200);
    final AtomicReference<String> reply = new AtomicReference<>(CUSTOMER);
    final List<String> paths = new ArrayList<>();
    final List<String> auths = new ArrayList<>();

    @BeforeEach
    void start() throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> {
            paths.add(exchange.getRequestURI().getRawPath());
            auths.add(exchange.getRequestHeaders().getFirst("Authorization"));
            byte[] bytes = reply.get().getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(status.get(), bytes.length);
            try (OutputStream out = exchange.getResponseBody()) {
                out.write(bytes);
            }
        });
        server.start();
    }

    @AfterEach
    void stop() {
        server.stop(0);
    }

    RevenueCatGatewayImpl gateway() {
        return new RevenueCatGatewayImpl("sk_test_secret", "pro", "http://127.0.0.1:" + server.getAddress().getPort());
    }

    @Test
    void readsTheEntitlementSubscriptionWithTheSecretKey() {
        StoreSubscription sub = gateway().entitlement("11111111-1111-4111-8111-111111111111").orElseThrow();
        assertThat(paths).containsExactly("/v1/subscribers/11111111-1111-4111-8111-111111111111");
        assertThat(auths).containsExactly("Bearer sk_test_secret");
        assertThat(sub.store()).isEqualTo("app_store");
        assertThat(sub.productId()).isEqualTo("acttub_pro_monthly");
        assertThat(sub.expiresDate()).isEqualTo(Instant.parse("2026-12-03T01:00:00Z"));
        assertThat(sub.purchaseDate()).isEqualTo(Instant.parse("2026-11-03T01:00:00Z"));
        assertThat(sub.unsubscribeDetectedAt()).isEqualTo(Instant.parse("2026-11-04T02:00:00Z"));
        assertThat(sub.billingIssuesDetectedAt()).isNull();
        assertThat(sub.refundedAt()).isNull();
        assertThat(sub.sandbox()).isTrue();
        assertThat(sub.storeTransactionId()).isEqualTo("2000000123");
    }

    @Test
    void appUserIdIsUrlEncoded() {
        gateway().entitlement("$RCAnonymousID:a b");
        assertThat(paths.get(0)).isEqualTo("/v1/subscribers/%24RCAnonymousID%3Aa%20b");
    }

    @Test
    void noEntitlementOrUnknownCustomerIsEmpty() {
        reply.set("{\"subscriber\":{\"entitlements\":{},\"subscriptions\":{}}}");
        assertThat(gateway().entitlement("u")).isEmpty();
        status.set(404);
        reply.set("{\"code\":7259}");
        assertThat(gateway().entitlement("u")).isEmpty();
    }

    @Test
    void rejectedKeyIsUnavailableAndOutagesAreUpstream() {
        status.set(401);
        assertThatThrownBy(() -> gateway().entitlement("u")).isInstanceOfSatisfying(StoreException.class,
                e -> assertThat(e.kind()).isEqualTo(StoreException.Kind.UNAVAILABLE));
        status.set(500);
        assertThatThrownBy(() -> gateway().entitlement("u")).isInstanceOfSatisfying(StoreException.class,
                e -> assertThat(e.kind()).isEqualTo(StoreException.Kind.UPSTREAM));
        status.set(429);
        assertThatThrownBy(() -> gateway().entitlement("u")).isInstanceOfSatisfying(StoreException.class,
                e -> assertThat(e.kind()).isEqualTo(StoreException.Kind.UPSTREAM));
        status.set(200);
        reply.set("not json");
        assertThatThrownBy(() -> gateway().entitlement("u")).isInstanceOfSatisfying(StoreException.class,
                e -> assertThat(e.kind()).isEqualTo(StoreException.Kind.UPSTREAM));
    }

    @Test
    void googleBasePlanProductMatchesTheSubscriptionKey() throws Exception {
        String body = """
                {"subscriber":{"entitlements":{"pro":{"product_identifier":"acttub_pro_yearly:yearly",
                  "expires_date":"2027-11-03T01:00:00Z","purchase_date":"2026-11-03T01:00:00Z","grace_period_expires_date":null}},
                 "subscriptions":{"acttub_pro_yearly":{"store":"play_store","expires_date":"2027-11-03T01:00:00Z",
                  "billing_issues_detected_at":"2027-11-03T02:00:00Z","grace_period_expires_date":"2027-11-10T01:00:00Z",
                  "refunded_at":null,"unsubscribe_detected_at":null,"is_sandbox":false,"store_transaction_id":"GPA.1..0"}}}}
                """;
        StoreSubscription sub = RevenueCatGatewayImpl.parse(JSON.readTree(body), "pro").orElseThrow();
        assertThat(sub.productId()).isEqualTo("acttub_pro_yearly");
        assertThat(sub.store()).isEqualTo("play_store");
        assertThat(sub.billingIssuesDetectedAt()).isEqualTo(Instant.parse("2027-11-03T02:00:00Z"));
        assertThat(sub.gracePeriodExpiresDate()).isEqualTo(Instant.parse("2027-11-10T01:00:00Z"));
        assertThat(sub.sandbox()).isFalse();
    }

    @Test
    void entitlementWithoutASubscriptionHasNoStore() throws Exception {
        String body = """
                {"subscriber":{"entitlements":{"pro":{"product_identifier":"rc_promo_pro_monthly",
                  "expires_date":"2026-12-03T01:00:00Z","purchase_date":"2026-11-03T01:00:00Z"}},"subscriptions":{}}}
                """;
        Optional<StoreSubscription> sub = RevenueCatGatewayImpl.parse(JSON.readTree(body), "pro");
        assertThat(sub).isPresent();
        assertThat(sub.get().store()).isNull();
        assertThat(RevenueCatGatewayImpl.parse(JSON.readTree(body), "other")).isEmpty();
    }

    @Test
    void missingConfigurationIsRejected() {
        assertThatThrownBy(() -> new RevenueCatGatewayImpl(" ", "pro")).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new RevenueCatGatewayImpl("sk_x", "")).isInstanceOf(IllegalArgumentException.class);
    }
}
