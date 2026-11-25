package com.acttub.actingapi.feature.billing;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
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
import com.acttub.actingapi.feature.billing.app.BillingMailer;
import com.acttub.actingapi.feature.billing.app.BillingRules;
import com.acttub.actingapi.feature.billing.app.PgReviewGateway;
import com.acttub.actingapi.feature.billing.app.RefundNotifier;
import com.acttub.actingapi.feature.billing.app.RenewalWorker;
import com.acttub.actingapi.support.AccountFixtures;
import com.acttub.actingapi.support.MutableClock;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import org.assertj.core.api.SoftAssertions;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import com.acttub.actingapi.platform.json.LenientJson;

/**
 * 앱 Pro 정기결제(SOMA-818)를 실제 Postgres·Spring 으로 본다: 카드 등록 창 → 토스 콜백 → 첫 결제 → 해지 → 기간 끝 expired,
 * 자동결제 실패·재시도, 결과 모르는 결제의 재확인, 무료 한도. 토스는 가짜 Port 이고 외부 호출은 없다.
 */
@SpringBootTest(properties = {
        "JWT_SECRET=test-secret",
        "BILLING_WEB_ENABLED=true",
        "BILLING_WEB_RETURN_URL=https://acttub.com/pricing/result",
        "BILLING_FREE_LIMITS_ENABLED=true",
        "BILLING_LEGACY_SIGNUP_BEFORE=2000-01-01T00:00:00Z",
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

    @MockitoBean
    BillingMailer mailer;

    @MockitoBean
    RefundNotifier refunds;

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
        jdbc.update("INSERT INTO users(id,status,email) VALUES (?,'active','actor@example.com')", USER);
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
                .when(gateway).approve(anyString(), anyString(), anyString(), anyLong(), anyString(), any(), anyString());
    }

    @Test
    @DisplayName("카드 등록 창 → 토스 성공 콜백 → 첫 결제 → active, 빌링키는 암호문이고 같은 콜백은 한 번만 쓴다")
    void subscribeThenCancelThenExpire() throws Exception {
        assertThat(me().path("status").stringValue(null)).isEqualTo("none");
        String state = openCheckout("subscribe");

        MockHttpServletResponse page = mvc.perform(get("/v2/billing/web/checkout/{state}", state)).andReturn().getResponse();
        assertThat(page.getStatus()).isEqualTo(200);
        assertThat(page.getContentAsString()).contains("requestBillingAuth").contains("test_ck_fakefakefake1234");
        String customerKey = jdbc.queryForObject("SELECT customer_key FROM billing_checkouts", String.class);

        assertThat(callback(state, customerKey)).isEqualTo("https://acttub.com/pricing/result?status=done");
        assertThat(callback(state, customerKey)).isEqualTo("https://acttub.com/pricing/result?status=invalid");

        JsonNode active = me();
        assertThat(active.path("status").stringValue(null)).isEqualTo("active");
        assertThat(active.path("pro").booleanValue(false)).isTrue();
        assertThat(active.path("card_last4").stringValue(null)).isEqualTo("123*");
        assertThat(jdbc.queryForObject("SELECT billing_key FROM billing_subscriptions", String.class))
                .isNotBlank().doesNotContain("bk_plain_secret");
        assertThat(jdbc.queryForObject("SELECT count(*) FROM billing_payments WHERE status='done'", Integer.class)).isEqualTo(1);
        assertThat(LenientJson.asText(json(post("/v2/billing/checkout").content("{\"purpose\":\"subscribe\"}"), 409).path("detail")))
                .contains("already_subscribed");

        JsonNode canceled = json(post("/v2/billing/subscription/cancel"), 200);
        assertThat(canceled.path("status").stringValue(null)).isEqualTo("canceled");
        assertThat(canceled.path("pro").booleanValue(false)).isTrue();

        clock.set(Instant.parse("2026-11-23T01:00:01Z"));
        assertThat(worker.runOnce()).isTrue();
        assertThat(worker.runOnce()).isFalse();
        assertThat(me().path("status").stringValue(null)).isEqualTo("expired");
        assertThat(jdbc.queryForObject("SELECT billing_key FROM billing_subscriptions", String.class)).isNull();
        // 첫 결제가 승인되면 가입 메일·프로필 이름으로 구독 메일을 한 번 부른다(SOMA-961).
        org.mockito.Mockito.verify(mailer, org.mockito.Mockito.atLeastOnce()).paymentDone(org.mockito.ArgumentMatchers.argThat(
                mail -> mail.first() && "actor@example.com".equals(mail.to()) && "테스트 배우".equals(mail.name())));
    }

    @Test
    @DisplayName("토스 성공 콜백이 빌링키 발급을 기다리는 사이에 다른 기기에서 탈퇴 — 카드를 저장하지 않고 결제하지 않으며 구독이 살아나지 않는다. "
            + "콜백은 failed 로 돌려보내고 다음 달 자동결제도 돌지 않는다")
    void withdrawalWhileTheCallbackWaitsForTheKeyStopsTheCharge() throws Exception {
        String state = openCheckout("subscribe");
        String customerKey = jdbc.queryForObject("SELECT customer_key FROM billing_checkouts", String.class);
        doAnswer(call -> {
            int withdrawn = mvc.perform(delete("/v2/me").header("Authorization", bearer)).andReturn().getResponse().getStatus();
            assertThat(withdrawn).as("다른 기기의 탈퇴").isEqualTo(200);
            return new PgReviewGateway.IssuedKey("bk_plain_secret", "신한", "43301234****123*");
        }).when(gateway).issue(anyString(), anyString());

        String result = callback(state, customerKey);
        clock.set(Instant.parse("2026-11-23T01:00:01Z"));
        boolean renewed = worker.runOnce();

        SoftAssertions.assertSoftly(soft -> {
            soft.assertThat(result).as("콜백 결과").isEqualTo("https://acttub.com/pricing/result?status=failed");
            soft.assertThat(jdbc.queryForObject(
                    "SELECT count(*) FROM billing_subscriptions WHERE billing_key IS NOT NULL", Integer.class))
                    .as("탈퇴한 계정의 빌링키").isZero();
            soft.assertThat(jdbc.queryForObject(
                    "SELECT count(*) FROM billing_subscriptions WHERE status<>'expired'", Integer.class))
                    .as("탈퇴한 계정의 살아 있는 구독").isZero();
            soft.assertThat(jdbc.queryForObject("SELECT count(*) FROM billing_payments", Integer.class))
                    .as("탈퇴한 계정의 결제").isZero();
            soft.assertThat(renewed).as("다음 달 자동결제").isFalse();
        });
        verify(refunds, never()).refundNeeded(any());
    }

    @Test
    @DisplayName("첫 결제 승인을 기다리는 사이에 다른 기기에서 탈퇴 — 승인된 결제는 기록에 남지만 구독은 active 가 되지 않고 "
            + "콜백은 failed 다. 그 주문 ID 와 금액을 환불 대상으로 알린다")
    void withdrawalWhileTheFirstChargeIsApprovedLeavesNoSubscription() throws Exception {
        String state = openCheckout("subscribe");
        String customerKey = jdbc.queryForObject("SELECT customer_key FROM billing_checkouts", String.class);
        doAnswer(call -> {
            int withdrawn = mvc.perform(delete("/v2/me").header("Authorization", bearer)).andReturn().getResponse().getStatus();
            assertThat(withdrawn).as("다른 기기의 탈퇴").isEqualTo(200);
            return new PgReviewGateway.Approval("DONE", call.getArgument(2), call.getArgument(3), "2026-10-23T10:00:00+09:00");
        }).when(gateway).approve(anyString(), anyString(), anyString(), anyLong(), anyString(), any(), anyString());

        String result = callback(state, customerKey);

        SoftAssertions.assertSoftly(soft -> {
            soft.assertThat(result).as("콜백 결과").isEqualTo("https://acttub.com/pricing/result?status=failed");
            soft.assertThat(jdbc.queryForObject(
                    "SELECT count(*) FROM billing_subscriptions WHERE status<>'expired' OR billing_key IS NOT NULL", Integer.class))
                    .as("탈퇴한 계정의 살아 있는 구독").isZero();
            soft.assertThat(jdbc.queryForObject("SELECT count(*) FROM billing_payments WHERE status='done'", Integer.class))
                    .as("이미 승인된 첫 결제").isEqualTo(1);
        });
        String orderId = jdbc.queryForObject("SELECT order_id FROM billing_payments WHERE status='done'", String.class);
        verify(refunds).refundNeeded(new RefundNotifier.Refund(orderId, 3900));
    }

    @Test
    @DisplayName("첫 결제가 거절되면 등록한 카드의 빌링키를 지운다 — 구독은 expired(응답은 none) 그대로다")
    void aRejectedFirstPaymentDropsTheBillingKey() throws Exception {
        String state = openCheckout("subscribe");
        String customerKey = jdbc.queryForObject("SELECT customer_key FROM billing_checkouts", String.class);
        doThrow(new PgReviewGateway.GatewayException(PgReviewGateway.GatewayException.Outcome.REJECTED, "REJECT_CARD"))
                .when(gateway).approve(anyString(), anyString(), anyString(), anyLong(), anyString(), any(), anyString());

        assertThat(callback(state, customerKey)).isEqualTo("https://acttub.com/pricing/result?status=failed");

        assertThat(jdbc.queryForMap("SELECT status, billing_key IS NULL AS no_key FROM billing_subscriptions"))
                .containsEntry("status", "expired").containsEntry("no_key", true);
        assertThat(me().path("status").stringValue(null)).isEqualTo("none");
    }

    @Test
    @DisplayName("결과를 모르던 첫 결제가 나중에 거절로 확인되면 빌링키를 지운다 — 결과를 모르는 동안은 남긴다")
    void anUnknownFirstPaymentConfirmedAsRejectedDropsTheKey() throws Exception {
        String state = openCheckout("subscribe");
        String customerKey = jdbc.queryForObject("SELECT customer_key FROM billing_checkouts", String.class);
        doThrow(new PgReviewGateway.GatewayException(PgReviewGateway.GatewayException.Outcome.UNKNOWN, "gateway_unreachable"))
                .when(gateway).approve(anyString(), anyString(), anyString(), anyLong(), anyString(), any(), anyString());
        assertThat(callback(state, customerKey)).isEqualTo("https://acttub.com/pricing/result?status=unknown");
        assertThat(jdbc.queryForObject("SELECT billing_key IS NOT NULL FROM billing_subscriptions", Boolean.class))
                .as("결과를 모르는 동안은 같은 키로 다시 물어야 해서 남긴다").isTrue();

        doThrow(new PgReviewGateway.GatewayException(PgReviewGateway.GatewayException.Outcome.REJECTED, "REJECT_CARD"))
                .when(gateway).approve(anyString(), anyString(), anyString(), anyLong(), anyString(), any(), anyString());
        // 기록 시각은 DB 의 now() 일 수 있다. 다시 묻는 차례(10분 뒤)를 지금 기준으로 넘긴다.
        clock.set(Instant.now().plus(Duration.ofMinutes(15)));
        assertThat(worker.runOnce()).isTrue();

        assertThat(jdbc.queryForObject("SELECT status FROM billing_payments", String.class)).isEqualTo("failed");
        assertThat(jdbc.queryForMap("SELECT status, billing_key IS NULL AS no_key FROM billing_subscriptions"))
                .containsEntry("status", "expired").containsEntry("no_key", true);
    }

    @Test
    @DisplayName("자동결제 — 성공하면 다음 기간, 거절되면 past_due 와 재시도, 재시도가 성공하면 active, 결과 모르면 같은 주문으로 다시 묻는다")
    void renewals() throws Exception {
        subscribe();
        clock.set(Instant.parse("2026-11-23T01:00:01Z"));
        assertThat(worker.runOnce()).isTrue();
        assertThat(jdbc.queryForObject("SELECT current_period_end FROM billing_subscriptions", OffsetDateTime.class).toInstant())
                .isEqualTo(Instant.parse("2026-12-23T01:00:00Z"));

        clock.set(Instant.parse("2026-12-23T01:00:01Z"));
        doThrow(new PgReviewGateway.GatewayException(PgReviewGateway.GatewayException.Outcome.REJECTED, "REJECT_CARD"))
                .when(gateway).approve(anyString(), anyString(), anyString(), anyLong(), anyString(), any(), anyString());
        assertThat(worker.runOnce()).isTrue();
        JsonNode pastDue = me();
        assertThat(pastDue.path("status").stringValue(null)).isEqualTo("past_due");
        assertThat(LenientJson.intValue(pastDue.path("retry_count"))).isEqualTo(1);
        assertThat(worker.runOnce()).isFalse();

        approveAll();
        clock.set(Instant.parse("2026-12-24T01:00:02Z"));
        assertThat(worker.runOnce()).isTrue();
        assertThat(me().path("status").stringValue(null)).isEqualTo("active");

        clock.set(Instant.parse("2027-01-23T01:00:01Z"));
        doThrow(new PgReviewGateway.GatewayException(PgReviewGateway.GatewayException.Outcome.UNKNOWN, "gateway_unreachable"))
                .when(gateway).approve(anyString(), anyString(), anyString(), anyLong(), anyString(), any(), anyString());
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
    @DisplayName("결제 기록은 승인 전에 unknown 으로 들어간다 — 승인이 예상 밖 예외로 끊겨도 결과 모름으로 남아 같은 키로 다시 묻는다")
    void aPaymentInterruptedBeforeTheAnswerStaysUnknownAndIsRechecked() throws Exception {
        subscribe();
        clock.set(Instant.parse("2026-11-23T01:00:01Z"));
        doThrow(new IllegalStateException("서버가 승인 응답을 받기 전에 멈춘 것과 같다"))
                .when(gateway).approve(anyString(), anyString(), anyString(), anyLong(), anyString(), any(), anyString());
        assertThatThrownBy(worker::runOnce).isInstanceOf(IllegalStateException.class);

        assertThat(jdbc.queryForList("SELECT status FROM billing_payments WHERE kind='renewal'", String.class))
                .containsExactly("unknown");
        assertThat(worker.runOnce()).as("결과를 모르는 동안 새로 결제하지 않는다").isFalse();

        approveAll();
        // 승인 전 기록의 시각은 DB 의 now() 다. 다시 묻는 차례(10분 뒤)를 그 시각 기준으로 넘긴다.
        clock.set(Instant.now().plus(Duration.ofMinutes(15)));
        assertThat(worker.runOnce()).isTrue();
        assertThat(jdbc.queryForList("SELECT status FROM billing_payments WHERE kind='renewal'", String.class))
                .containsExactly("done");
        assertThat(jdbc.queryForObject("SELECT current_period_end FROM billing_subscriptions", OffsetDateTime.class).toInstant())
                .isEqualTo(Instant.parse("2026-12-23T01:00:00Z"));
    }

    @Test
    @DisplayName("옛 서버가 남긴 pending 결제도 결과 모름으로 읽는다 — 새로 결제하지 않고 같은 키로 다시 물은 뒤 풀린다")
    void aPendingPaymentLeftByTheOldServerIsStillUnresolved() throws Exception {
        subscribe();
        UUID subscription = jdbc.queryForObject("SELECT id FROM billing_subscriptions", UUID.class);
        Instant start = Instant.parse("2026-11-23T01:00:00Z");
        jdbc.update("""
                INSERT INTO billing_payments(id,subscription_id,user_id,order_id,kind,amount,status,period_start,period_end,attempt,
                    created_at,updated_at)
                VALUES (?,?,?,?,'renewal',3900,'pending',?,?,1,?,?)
                """, UUID.randomUUID(), subscription, USER,
                BillingRules.renewalOrderId(subscription, start, 1),
                OffsetDateTime.ofInstant(start, ZoneOffset.UTC),
                OffsetDateTime.parse("2026-12-23T01:00:00Z"),
                OffsetDateTime.parse("2026-11-23T00:59:00Z"), OffsetDateTime.parse("2026-11-23T00:59:00Z"));
        clock.set(Instant.parse("2026-11-23T01:00:01Z"));

        assertThat(worker.runOnce()).as("pending 이 있는 구독은 새로 결제하지 않는다").isFalse();

        clock.advance(Duration.ofMinutes(15));
        assertThat(worker.runOnce()).isTrue();
        assertThat(jdbc.queryForList("SELECT status FROM billing_payments WHERE kind='renewal'", String.class))
                .containsExactly("done");
        verify(gateway).approve(anyString(), anyString(), eq(BillingRules.renewalOrderId(subscription, start, 1)),
                anyLong(), anyString(), any(), anyString());
    }

    @Test
    @DisplayName("웹 연 구독 스위치가 꺼져 있으면(기본) yearly 창은 422 plan_unavailable 이고, plan 을 생략하거나 monthly 면 월 구독 그대로다")
    void yearlyClosedByDefault() throws Exception {
        assertThat(LenientJson.asText(json(post("/v2/billing/checkout").content("{\"purpose\":\"subscribe\",\"plan\":\"yearly\"}"), 422)
                .path("detail"))).contains("plan_unavailable");
        assertThat(LenientJson.asText(json(post("/v2/billing/checkout").content("{\"purpose\":\"subscribe\",\"plan\":\"weekly\"}"), 422)
                .path("detail"))).contains("invalid_plan");
        assertThat(jdbc.queryForObject("SELECT count(*) FROM billing_checkouts", Integer.class)).isZero();

        JsonNode started = json(post("/v2/billing/checkout").content("{\"purpose\":\"subscribe\",\"plan\":\"monthly\"}"), 200);
        String url = started.path("checkout_url").stringValue(null);
        String state = url.substring(url.lastIndexOf('/') + 1);
        assertThat(jdbc.queryForObject("SELECT plan FROM billing_checkouts", String.class)).isEqualTo("monthly");
        String customerKey = jdbc.queryForObject("SELECT customer_key FROM billing_checkouts", String.class);
        assertThat(callback(state, customerKey)).isEqualTo("https://acttub.com/pricing/result?status=done");

        JsonNode active = me();
        assertThat(active.path("plan").stringValue(null)).isEqualTo("monthly");
        assertThat(LenientJson.longValue(active.path("amount"))).isEqualTo(3900L);
        assertThat(jdbc.queryForObject("SELECT plan FROM billing_subscriptions", String.class)).isEqualTo("monthly");
        assertThat(jdbc.queryForObject("SELECT amount FROM billing_payments", Integer.class)).isEqualTo(3900);
        org.mockito.Mockito.verify(gateway).approve(anyString(), anyString(), anyString(),
                org.mockito.ArgumentMatchers.eq(3900L), org.mockito.ArgumentMatchers.eq("ACTTUB Pro 월 구독"), any(), anyString());
    }

    @Test
    @DisplayName("카드 바꾸기·실패 콜백·잘못된 창, 게스트·잘못된 목적")
    void changeCardAndFailures() throws Exception {
        assertThat(LenientJson.asText(json(post("/v2/billing/checkout").content("{\"purpose\":\"change_card\"}"), 409).path("detail")))
                .contains("no_subscription");
        assertThat(LenientJson.asText(json(post("/v2/billing/checkout").content("{\"purpose\":\"refund\"}"), 422).path("detail")))
                .contains("invalid_purpose");

        String failed = openCheckout("subscribe");
        assertThat(redirect(get("/v2/billing/web/checkout/{state}/fail", failed).param("code", "PAY_PROCESS_CANCELED")))
                .isEqualTo("https://acttub.com/pricing/result?status=canceled");
        assertThat(mvc.perform(get("/v2/billing/web/checkout/{state}", failed)).andReturn().getResponse().getStatus())
                .isEqualTo(404);

        subscribe();
        String change = openCheckout("change_card");
        String customerKey = jdbc.queryForObject(
                "SELECT customer_key FROM billing_checkouts WHERE purpose='change_card'", String.class);
        when(gateway.issue(anyString(), anyString()))
                .thenReturn(new PgReviewGateway.IssuedKey("bk_new_secret", "현대", "51001234****9876"));
        assertThat(callback(change, customerKey)).isEqualTo("https://acttub.com/pricing/result?status=done");
        assertThat(me().path("card_last4").stringValue(null)).isEqualTo("9876");
        assertThat(jdbc.queryForObject("SELECT count(*) FROM billing_payments", Integer.class)).isEqualTo(1);
    }

    @Test
    @DisplayName("무료 한도가 켜져 있으면 Pro 가 아닌 사람은 하루 코칭 3번까지 되고 네 번째는 429 free_daily_coaching_limit")
    void freeCoachingLimit() throws Exception {
        String talk = "{\"request_id\":\"%s\",\"session_purpose\":\"concern\"}";
        for (int index = 0; index < 3; index++) {
            json(post("/v2/practices").content(talk.formatted(UUID.randomUUID())), 201);
        }
        assertThat(LenientJson.asText(json(post("/v2/practices").content(talk.formatted(UUID.randomUUID())), 429).path("detail")))
                .contains("free_daily_coaching_limit");
        assertThat(jdbc.queryForObject("SELECT count(*) FROM practices", Integer.class)).isEqualTo(3);
    }

    @Test
    @DisplayName("무료 한도가 켜져 있으면 Pro 가 아닌 사람은 리딩 대본 3개까지 보관하고 네 번째는 403 free_script_limit")
    void freeScriptLimit() throws Exception {
        for (int index = 0; index < 3; index++) {
            json(post("/v2/reading/scripts").content(script("대본 " + index)), 201);
        }
        assertThat(LenientJson.asText(json(post("/v2/reading/scripts").content(script("대본 4")), 403).path("detail")))
                .contains("free_script_limit");
        assertThat(jdbc.queryForObject("SELECT count(*) FROM scripts", Integer.class)).isEqualTo(3);
    }

    /** 배역 둘, 대사 둘인 직접 저장 본문. */
    private String script(String title) {
        var body = mapper.createObjectNode();
        body.put("request_id", UUID.randomUUID().toString());
        body.put("title", title);
        body.put("source", "paste");
        body.put("raw_text", title + " 원문");
        var characters = body.putArray("characters");
        characters.addObject().put("name", "니나");
        characters.addObject().put("name", "트레플레프");
        var lines = body.putArray("lines");
        for (int index = 0; index < 2; index++) {
            lines.addObject().put("ordinal", index + 1).put("kind", "dialogue").put("character_index", index)
                    .put("text", "대사 " + (index + 1));
        }
        return body.toString();
    }

    private void subscribe() throws Exception {
        String state = openCheckout("subscribe");
        String customerKey = jdbc.queryForObject(
                "SELECT customer_key FROM billing_checkouts WHERE status='open' AND purpose='subscribe'", String.class);
        assertThat(callback(state, customerKey)).isEqualTo("https://acttub.com/pricing/result?status=done");
    }

    private String openCheckout(String purpose) throws Exception {
        JsonNode started = json(post("/v2/billing/checkout").content("{\"purpose\":\"" + purpose + "\"}"), 200);
        String url = started.path("checkout_url").stringValue(null);
        assertThat(url).startsWith("https://billing.acttub.test/v2/billing/web/checkout/");
        assertThat(started.path("return_url").stringValue(null)).isEqualTo("https://acttub.com/pricing/result");
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
