package com.acttub.actingapi.feature.billing;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.auth.app.JwtService;
import com.acttub.actingapi.feature.billing.app.AppBillingGateway;
import com.acttub.actingapi.feature.billing.app.PgReviewGateway;
import com.acttub.actingapi.feature.billing.app.RenewalWorker;
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
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

/**
 * 앱 Pro 정기결제(SOMA-818)를 실제 Postgres·Spring 으로 본다: 카드 등록 창 → 토스 콜백 → 첫 결제 → 해지 → 기간 끝 expired,
 * 자동결제 실패·재시도, 결과 모르는 결제의 재확인, 무료 한도. 토스는 가짜 Port 이고 외부 호출은 없다.
 */
@SpringBootTest(properties = {
        "JWT_SECRET=test-secret",
        "ACCOUNT_CLEANUP_ENABLED=false",
        "ACCOUNT_HOUSEKEEPING_ENABLED=false",
        "BILLING_APP_ENABLED=true",
        "BILLING_FREE_LIMITS_ENABLED=true",
        "BILLING_PUBLIC_ORIGIN=https://billing.acttub.test",
        "BILLING_TOSS_CLIENT_KEY=test_ck_fakefakefake1234",
        "BILLING_TOSS_SECRET_KEY=test_sk_fakefakefake1234",
        "BILLING_RENEWAL_POLL_MS=3600000",
        "BILLING_RENEWAL_INITIAL_DELAY_MS=3600000"})
@AutoConfigureMockMvc
@Import(MutableClock.Fixture.class)
class BillingEndpointIT {
    static final UUID USER = UUID.fromString("33333333-3333-4333-8333-333333333333");
    private static final OffsetDateTime PUBLISHED = OffsetDateTime.of(2026, 10, 1, 0, 0, 0, 0, ZoneOffset.UTC);

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        String name = PostgresContainerSupport.createDatabaseName("billing_app");
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
    @Autowired
    RenewalWorker worker;

    @MockitoBean
    AppBillingGateway gateway;

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
        clock.set(Instant.parse("2026-10-23T01:00:00Z"));
        jdbc.update("INSERT INTO users(id,status) VALUES (?,'active')", USER);
        jdbc.update("INSERT INTO user_identities(id,user_id,provider,provider_uid) VALUES (?,?,'google',?)",
                UUID.randomUUID(), USER, "g-" + USER);
        AccountFixtures.passGate(jdbc, USER);
        bearer = "Bearer " + jwt.issueAccessToken(USER).value();
        when(gateway.issue(anyString(), anyString()))
                .thenReturn(new PgReviewGateway.IssuedKey("bk_plain_secret", "신한", "43301234****123*"));
        approveAll();
    }

    private void approveAll() {
        // doAnswer 꼴로 건다 — when(...) 꼴은 앞서 건 thenThrow 를 실제로 불러 버린다.
        doAnswer(call -> new PgReviewGateway.Approval("DONE", call.getArgument(2), call.getArgument(3),
                "2026-10-23T10:00:00+09:00"))
                .when(gateway).approve(anyString(), anyString(), anyString(), anyLong(), anyString(), anyString());
    }

    @Test
    @DisplayName("카드 등록 창 → 토스 성공 콜백 → 첫 결제 → active, 빌링키는 암호문이고 같은 콜백은 한 번만 쓴다")
    void subscribeThenCancelThenExpire() throws Exception {
        assertThat(me().path("status").textValue()).isEqualTo("none");
        String state = openCheckout("subscribe");

        MockHttpServletResponse page = mvc.perform(get("/v2/billing/web/checkout/{state}", state)).andReturn().getResponse();
        assertThat(page.getStatus()).isEqualTo(200);
        assertThat(page.getContentAsString()).contains("requestBillingAuth").contains("test_ck_fakefakefake1234");
        String customerKey = jdbc.queryForObject("SELECT customer_key FROM billing_checkouts", String.class);

        assertThat(callback(state, customerKey)).isEqualTo("actingapp://billing-result?status=done");
        assertThat(callback(state, customerKey)).isEqualTo("actingapp://billing-result?status=invalid");

        JsonNode active = me();
        assertThat(active.path("status").textValue()).isEqualTo("active");
        assertThat(active.path("pro").booleanValue()).isTrue();
        assertThat(active.path("card_last4").textValue()).isEqualTo("123*");
        assertThat(jdbc.queryForObject("SELECT billing_key FROM billing_subscriptions", String.class))
                .isNotBlank().doesNotContain("bk_plain_secret");
        assertThat(jdbc.queryForObject("SELECT count(*) FROM billing_payments WHERE status='done'", Integer.class)).isEqualTo(1);
        assertThat(json(post("/v2/billing/checkout").content("{\"purpose\":\"subscribe\"}"), 409).path("detail").asText())
                .contains("already_subscribed");

        JsonNode canceled = json(post("/v2/billing/subscription/cancel"), 200);
        assertThat(canceled.path("status").textValue()).isEqualTo("canceled");
        assertThat(canceled.path("pro").booleanValue()).isTrue();

        clock.set(Instant.parse("2026-11-23T01:00:01Z"));
        assertThat(worker.runOnce()).isTrue();
        assertThat(worker.runOnce()).isFalse();
        assertThat(me().path("status").textValue()).isEqualTo("expired");
        assertThat(jdbc.queryForObject("SELECT billing_key FROM billing_subscriptions", String.class)).isNull();
    }

    @Test
    @DisplayName("자동결제 — 성공하면 다음 기간, 거절되면 past_due 와 재시도, 「다시 시도」로 active, 결과 모르면 같은 주문으로 다시 묻는다")
    void renewals() throws Exception {
        subscribe();
        clock.set(Instant.parse("2026-11-23T01:00:01Z"));
        assertThat(worker.runOnce()).isTrue();
        assertThat(jdbc.queryForObject("SELECT current_period_end FROM billing_subscriptions", OffsetDateTime.class).toInstant())
                .isEqualTo(Instant.parse("2026-12-23T01:00:00Z"));

        clock.set(Instant.parse("2026-12-23T01:00:01Z"));
        doThrow(new PgReviewGateway.GatewayException(PgReviewGateway.GatewayException.Outcome.REJECTED, "REJECT_CARD"))
                .when(gateway).approve(anyString(), anyString(), anyString(), anyLong(), anyString(), anyString());
        assertThat(worker.runOnce()).isTrue();
        JsonNode pastDue = me();
        assertThat(pastDue.path("status").textValue()).isEqualTo("past_due");
        assertThat(pastDue.path("retry_count").intValue()).isEqualTo(1);
        assertThat(worker.runOnce()).isFalse();

        approveAll();
        assertThat(json(post("/v2/billing/subscription/retry"), 200).path("status").textValue()).isEqualTo("active");
        assertThat(json(post("/v2/billing/subscription/retry"), 409).path("detail").asText()).contains("not_past_due");

        clock.set(Instant.parse("2027-01-23T01:00:01Z"));
        doThrow(new PgReviewGateway.GatewayException(PgReviewGateway.GatewayException.Outcome.UNKNOWN, "gateway_unreachable"))
                .when(gateway).approve(anyString(), anyString(), anyString(), anyLong(), anyString(), anyString());
        assertThat(worker.runOnce()).isTrue();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM billing_payments WHERE status='unknown'", Integer.class)).isEqualTo(1);
        assertThat(worker.runOnce()).isFalse();

        approveAll();
        clock.advance(Duration.ofMinutes(15));
        assertThat(worker.runOnce()).isTrue();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM billing_payments WHERE status='unknown'", Integer.class)).isZero();
        assertThat(jdbc.queryForObject("SELECT current_period_end FROM billing_subscriptions", OffsetDateTime.class).toInstant())
                .isEqualTo(Instant.parse("2027-02-23T01:00:00Z"));
        assertThat(jdbc.queryForObject("SELECT count(DISTINCT order_id) FROM billing_payments", Integer.class))
                .isEqualTo(jdbc.queryForObject("SELECT count(*) FROM billing_payments", Integer.class));
    }

    @Test
    @DisplayName("카드 바꾸기·실패 콜백·잘못된 창, 게스트·잘못된 목적")
    void changeCardAndFailures() throws Exception {
        assertThat(json(post("/v2/billing/checkout").content("{\"purpose\":\"change_card\"}"), 409).path("detail").asText())
                .contains("no_subscription");
        assertThat(json(post("/v2/billing/checkout").content("{\"purpose\":\"refund\"}"), 422).path("detail").asText())
                .contains("invalid_purpose");

        String failed = openCheckout("subscribe");
        assertThat(redirect(get("/v2/billing/web/checkout/{state}/fail", failed).param("code", "PAY_PROCESS_CANCELED")))
                .isEqualTo("actingapp://billing-result?status=canceled");
        assertThat(mvc.perform(get("/v2/billing/web/checkout/{state}", failed)).andReturn().getResponse().getStatus())
                .isEqualTo(404);

        subscribe();
        String change = openCheckout("change_card");
        String customerKey = jdbc.queryForObject(
                "SELECT customer_key FROM billing_checkouts WHERE purpose='change_card'", String.class);
        when(gateway.issue(anyString(), anyString()))
                .thenReturn(new PgReviewGateway.IssuedKey("bk_new_secret", "현대", "51001234****9876"));
        assertThat(callback(change, customerKey)).isEqualTo("actingapp://billing-result?status=done");
        assertThat(me().path("card_last4").textValue()).isEqualTo("9876");
        assertThat(jdbc.queryForObject("SELECT count(*) FROM billing_payments", Integer.class)).isEqualTo(1);
    }

    @Test
    @DisplayName("무료 한도가 켜져 있으면 Pro 가 아닌 사람의 두 번째 코칭은 429 free_daily_coaching_limit, Pro 면 막지 않는다")
    void freeCoachingLimit() throws Exception {
        String talk = "{\"request_id\":\"%s\",\"session_purpose\":\"concern\"}";
        json(post("/v2/practices").content(talk.formatted(UUID.randomUUID())), 201);
        assertThat(json(post("/v2/practices").content(talk.formatted(UUID.randomUUID())), 429).path("detail").asText())
                .contains("free_daily_coaching_limit");
    }

    private void subscribe() throws Exception {
        String state = openCheckout("subscribe");
        String customerKey = jdbc.queryForObject(
                "SELECT customer_key FROM billing_checkouts WHERE status='open' AND purpose='subscribe'", String.class);
        assertThat(callback(state, customerKey)).isEqualTo("actingapp://billing-result?status=done");
    }

    private String openCheckout(String purpose) throws Exception {
        JsonNode started = json(post("/v2/billing/checkout").content("{\"purpose\":\"" + purpose + "\"}"), 200);
        String url = started.path("checkout_url").textValue();
        assertThat(url).startsWith("https://billing.acttub.test/v2/billing/web/checkout/");
        assertThat(started.path("return_url").textValue()).isEqualTo("actingapp://billing-result");
        return url.substring(url.lastIndexOf('/') + 1);
    }

    private String callback(String state, String customerKey) throws Exception {
        return redirect(get("/v2/billing/web/checkout/{state}/success", state)
                .param("customerKey", customerKey).param("authKey", "auth_" + UUID.randomUUID()));
    }

    private String redirect(MockHttpServletRequestBuilder request) throws Exception {
        MockHttpServletResponse response = mvc.perform(request).andReturn().getResponse();
        assertThat(response.getStatus()).isEqualTo(302);
        return response.getHeader("Location");
    }

    private JsonNode me() throws Exception {
        return json(get("/v2/billing/me"), 200);
    }

    private JsonNode json(MockHttpServletRequestBuilder request, int status) throws Exception {
        MockHttpServletResponse response = mvc.perform(request
                        .header("Authorization", bearer)
                        .contentType(MediaType.APPLICATION_JSON))
                .andReturn()
                .getResponse();
        assertThat(response.getStatus()).as(response.getContentAsString()).isEqualTo(status);
        String body = response.getContentAsString();
        return body.isEmpty() ? mapper.nullNode() : mapper.readTree(body);
    }

}
