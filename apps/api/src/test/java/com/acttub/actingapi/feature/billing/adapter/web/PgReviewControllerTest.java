package com.acttub.actingapi.feature.billing.adapter.web;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import com.acttub.actingapi.feature.billing.adapter.web.PgReviewDtos.CheckoutResponse;
import com.acttub.actingapi.feature.billing.adapter.web.PgReviewDtos.LoginRequest;
import com.acttub.actingapi.feature.billing.app.PgReviewGateway;
import com.acttub.actingapi.feature.billing.app.PgReviewGateway.GatewayException;
import com.acttub.actingapi.feature.billing.app.PgReviewResult;
import com.acttub.actingapi.feature.billing.app.PgReviewService;
import com.acttub.actingapi.feature.billing.app.PgReviewSessions;
import com.acttub.actingapi.feature.billing.app.PgReviewSettings;
import com.acttub.actingapi.platform.security.ClientAddress;
import com.acttub.actingapi.platform.security.FixedWindowRateLimiter;
import com.acttub.actingapi.platform.web.ApiException;
import com.acttub.actingapi.support.MutableClock;
import jakarta.servlet.http.Cookie;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

/** PG 심사 전용 테스트 결제 API. 토스는 가짜 Port 이고 외부 호출·DB 는 없다. */
class PgReviewControllerTest {
    private static final String ORIGIN = "https://acttub.example";
    private static final String PASSWORD = "Zq7-longRandomReviewPassword-91";
    private static final String AUTH_KEY = "auth-key-secret-value";
    private static final String BILLING_KEY = "billing-key-secret-value";

    private final MutableClock clock = new MutableClock(Instant.parse("2026-10-20T00:00:00Z"));
    private final FakeGateway gateway = new FakeGateway();
    private final long[] nanos = {0L};
    private ListAppender<ILoggingEvent> logs;
    private PgReviewController controller;
    private PgReviewService service;

    @BeforeEach
    void setUp() {
        build(settings("test_sk_abcdefgh12345678"));
        logs = new ListAppender<>();
        logs.start();
        ((Logger) LoggerFactory.getLogger(Logger.ROOT_LOGGER_NAME)).addAppender(logs);
        ((Logger) LoggerFactory.getLogger(Logger.ROOT_LOGGER_NAME)).setLevel(Level.DEBUG);
    }

    @AfterEach
    void tearDown() {
        ((Logger) LoggerFactory.getLogger(Logger.ROOT_LOGGER_NAME)).detachAppender(logs);
    }

    private void build(PgReviewSettings settings) {
        service = new PgReviewService(settings, new PgReviewSessions(clock), gateway, clock);
        controller = new PgReviewController(service, new FixedWindowRateLimiter(() -> nanos[0]), new ClientAddress("none"));
    }

    private static PgReviewSettings settings(String secretKey) {
        return new PgReviewSettings(ORIGIN, "reviewer", sha256(PASSWORD), "test_ck_abcdefgh12345678", secretKey);
    }

    private static String sha256(String value) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    private static MockHttpServletRequest post(String origin, String cookie) {
        MockHttpServletRequest request = new MockHttpServletRequest("POST", "/v2/pg-review/x");
        request.setRemoteAddr("203.0.113.9");
        if (origin != null) {
            request.addHeader("Origin", origin);
        }
        if (cookie != null) {
            request.setCookies(new Cookie(PgReviewController.COOKIE, cookie));
        }
        return request;
    }

    private static MockHttpServletRequest get(String cookie) {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/v2/pg-review/x");
        request.setRemoteAddr("203.0.113.9");
        if (cookie != null) {
            request.setCookies(new Cookie(PgReviewController.COOKIE, cookie));
        }
        return request;
    }

    private String login() {
        MockHttpServletResponse response = new MockHttpServletResponse();
        controller.login(new LoginRequest("reviewer", PASSWORD), post(ORIGIN, null), response);
        String header = response.getHeader("Set-Cookie");
        return header.substring(header.indexOf('=') + 1, header.indexOf(';'));
    }

    private static String param(String url, String name) {
        int at = url.indexOf(name + "=");
        String rest = url.substring(at + name.length() + 1);
        int end = rest.indexOf('&');
        return end < 0 ? rest : rest.substring(0, end);
    }

    private CheckoutResponse checkout(String cookie) {
        return controller.checkout(post(ORIGIN, cookie), new MockHttpServletResponse());
    }

    private MockHttpServletResponse success(String cookie, String state, String customerKey, String authKey) {
        MockHttpServletRequest request = get(cookie);
        MockHttpServletResponse response = new MockHttpServletResponse();
        controller.success(state, customerKey, authKey, request, response);
        return response;
    }

    private PgReviewResult result(String cookie) {
        return controller.result(get(cookie), new MockHttpServletResponse());
    }

    private static int statusOf(Runnable action) {
        try {
            action.run();
        } catch (ApiException e) {
            return e.status();
        }
        return 200;
    }

    // ---- 꺼짐/잠금

    @Test
    void closedWhenSecretKeyIsLiveOrMalformedAndNothingReachesTheGateway() {
        for (String key : List.of("live_sk_abcdefgh12345678", "test_ck_abcdefgh12345678", "", "test_sk_", "sk_abcdefgh")) {
            build(settings(key));
            assertThat(controller.config(get(null), new MockHttpServletResponse()).available()).isFalse();
            assertThat(statusOf(() -> controller.login(new LoginRequest("reviewer", PASSWORD), post(ORIGIN, null),
                    new MockHttpServletResponse()))).isEqualTo(404);
        }
        assertThat(gateway.calls).isEmpty();
    }

    @Test
    void liveClientKeyOrBadOriginOrBadHashClosesTheFeature() {
        assertThat(new PgReviewSettings(ORIGIN, "u", sha256("x"), "live_ck_abcdefgh1234", "test_sk_abcdefgh1234").usable()).isFalse();
        assertThat(new PgReviewSettings("http://acttub.example", "u", sha256("x"), "test_ck_abcdefgh1234", "test_sk_abcdefgh1234").usable()).isFalse();
        assertThat(new PgReviewSettings("https://acttub.example/path", "u", sha256("x"), "test_ck_abcdefgh1234", "test_sk_abcdefgh1234").usable()).isFalse();
        assertThat(new PgReviewSettings(ORIGIN, "u", "not-a-hash", "test_ck_abcdefgh1234", "test_sk_abcdefgh1234").usable()).isFalse();
        assertThat(new PgReviewSettings(ORIGIN, "u", sha256("x"), "test_ck_abcdefgh1234", "test_sk_abcdefgh1234").usable()).isTrue();
        assertThat(new PgReviewSettings("http://localhost:3000", "u", sha256("x"), "test_ck_abcdefgh1234", "test_sk_abcdefgh1234").usable()).isTrue();
        assertThat(settings("test_sk_abcdefgh12345678").toString()).doesNotContain("abcdefgh12345678");
    }

    // ---- 로그인

    @Test
    void wrongPasswordOrUsernameIsRejectedAndSetsNoCookie() {
        MockHttpServletResponse response = new MockHttpServletResponse();
        assertThat(statusOf(() -> controller.login(new LoginRequest("reviewer", "nope"), post(ORIGIN, null), response)))
                .isEqualTo(401);
        assertThat(statusOf(() -> controller.login(new LoginRequest("other", PASSWORD), post(ORIGIN, null), response)))
                .isEqualTo(401);
        assertThat(response.getHeader("Set-Cookie")).isNull();
    }

    @Test
    void loginSetsHttpOnlySecureLaxCookieScopedToTheReviewPath() {
        MockHttpServletResponse response = new MockHttpServletResponse();
        assertThat(controller.login(new LoginRequest("reviewer", PASSWORD), post(ORIGIN, null), response).authenticated()).isTrue();
        String cookie = response.getHeader("Set-Cookie");
        assertThat(cookie).startsWith("acttub_pg_review=").contains("HttpOnly", "Secure", "SameSite=Lax",
                "Path=/v2/pg-review", "Max-Age=1800");
        assertThat(response.getHeader("Cache-Control")).isEqualTo("no-store");
    }

    @Test
    void loginAttemptsAreRateLimitedByAddressAndCorrectLoginDoesNotConsumeTheBudget() {
        for (int i = 0; i < 10; i++) {
            assertThat(statusOf(() -> controller.login(new LoginRequest("reviewer", "bad"), post(ORIGIN, null),
                    new MockHttpServletResponse()))).isEqualTo(401);
        }
        assertThat(statusOf(() -> controller.login(new LoginRequest("reviewer", PASSWORD), post(ORIGIN, null),
                new MockHttpServletResponse()))).isEqualTo(429);
        nanos[0] += Duration.ofMinutes(2).toNanos();
        for (int i = 0; i < 20; i++) {
            controller.login(new LoginRequest("reviewer", PASSWORD), post(ORIGIN, null), new MockHttpServletResponse());
        }
    }

    @Test
    void postsRequireTheExactConfiguredOrigin() {
        String cookie = login();
        for (String origin : new String[] {null, "https://evil.example", ORIGIN + ".evil.example", "http://acttub.example"}) {
            assertThat(statusOf(() -> controller.login(new LoginRequest("reviewer", PASSWORD), post(origin, null),
                    new MockHttpServletResponse()))).isEqualTo(403);
            assertThat(statusOf(() -> controller.checkout(post(origin, cookie), new MockHttpServletResponse()))).isEqualTo(403);
            assertThat(statusOf(() -> controller.logout(post(origin, cookie), new MockHttpServletResponse()))).isEqualTo(403);
        }
    }

    @Test
    void sessionsExpireAndLogoutEndsThem() {
        String cookie = login();
        assertThat(result(cookie).status()).isEqualTo("idle");
        clock.advance(Duration.ofMinutes(31));
        assertThat(statusOf(() -> result(cookie))).isEqualTo(401);
        assertThat(statusOf(() -> checkout(cookie))).isEqualTo(401);

        String second = login();
        MockHttpServletResponse response = new MockHttpServletResponse();
        controller.logout(post(ORIGIN, second), response);
        assertThat(response.getHeader("Set-Cookie")).contains("Max-Age=0");
        assertThat(statusOf(() -> result(second))).isEqualTo(401);
    }

    @Test
    void configShowsAuthenticationWithoutAnySecret() {
        assertThat(controller.config(get(null), new MockHttpServletResponse()))
                .isEqualTo(new PgReviewDtos.ConfigResponse(true, false, true, 3900));
        String cookie = login();
        assertThat(controller.config(get(cookie), new MockHttpServletResponse()).authenticated()).isTrue();
        assertThat(controller.config(get("forged"), new MockHttpServletResponse()).authenticated()).isFalse();
    }

    @Test
    void sessionStoreIsBounded() {
        for (int i = 0; i < PgReviewSessions.MAX_SESSIONS; i++) {
            login();
        }
        assertThat(statusOf(() -> controller.login(new LoginRequest("reviewer", PASSWORD), post(ORIGIN, null),
                new MockHttpServletResponse()))).isEqualTo(429);
        clock.advance(Duration.ofMinutes(31));
        login();
    }

    // ---- checkout / 콜백

    @Test
    void checkoutIssuesServerSideValuesAndFixedUrls() {
        String cookie = login();
        CheckoutResponse first = checkout(cookie);
        assertThat(first.clientKey()).startsWith("test_ck_");
        assertThat(first.customerKey()).startsWith("pgr_").hasSizeBetween(2, 50);
        assertThat(first.successUrl()).startsWith(ORIGIN + "/v2/pg-review/success?state=");
        assertThat(first.failUrl()).startsWith(ORIGIN + "/v2/pg-review/fail?state=");
        assertThat(param(first.successUrl(), "state")).isEqualTo(param(first.failUrl(), "state"));
        statusOf(() -> checkout(cookie));
        assertThat(checkout(cookie).customerKey()).isNotEqualTo(first.customerKey());
    }

    @Test
    void checkoutRequiresLogin() {
        assertThat(statusOf(() -> checkout(null))).isEqualTo(401);
    }

    @Test
    void happyPathApprovesExactlyOnceWithFixedAmountAndNeverStoresSecrets() {
        String cookie = login();
        CheckoutResponse checkout = checkout(cookie);
        String state = param(checkout.successUrl(), "state");
        MockHttpServletResponse response = success(cookie, state, checkout.customerKey(), AUTH_KEY);

        assertThat(response.getStatus()).isEqualTo(302);
        assertThat(response.getHeader("Location")).isEqualTo(ORIGIN + "/pg-review/result").doesNotContain("authKey");
        assertThat(response.getHeader("Referrer-Policy")).isEqualTo("no-referrer");
        assertThat(response.getHeader("Cache-Control")).isEqualTo("no-store");
        PgReviewResult result = result(cookie);
        assertThat(result.status()).isEqualTo("approved");
        assertThat(result.amount()).isEqualTo(3900);
        assertThat(result.testOnly()).isTrue();
        assertThat(result.orderId()).startsWith("pgr-");
        assertThat(result.approvedAt()).isEqualTo("2026-10-20T09:00:00+09:00");
        assertThat(gateway.issued).containsExactly(AUTH_KEY + "|" + checkout.customerKey());
        assertThat(gateway.approvals).hasSize(1);
        assertThat(gateway.approvals.get(0).amount).isEqualTo(3900L);
        assertThat(gateway.approvals.get(0).orderName).isEqualTo("ACTTUB Pro 월 구독 테스트");
        assertThat(gateway.approvals.get(0).idempotencyKey).isNotBlank();
        assertThat(result.toString() + new com.fasterxml.jackson.databind.ObjectMapper().valueToTree(result))
                .doesNotContain(AUTH_KEY, BILLING_KEY);
        assertNoSecretInLogs();
    }

    @Test
    void duplicateCallbackDoesNotCallTheGatewayTwice() {
        String cookie = login();
        CheckoutResponse checkout = checkout(cookie);
        String state = param(checkout.successUrl(), "state");
        success(cookie, state, checkout.customerKey(), AUTH_KEY);
        MockHttpServletResponse again = success(cookie, state, checkout.customerKey(), AUTH_KEY);
        assertThat(again.getStatus()).isEqualTo(302);
        assertThat(gateway.issued).hasSize(1);
        assertThat(gateway.approvals).hasSize(1);
        assertThat(result(cookie).status()).isEqualTo("approved");
        // 승인 뒤에는 새 시도도 발급하지 않는다.
        assertThat(statusOf(() -> checkout(cookie))).isEqualTo(409);
    }

    @Test
    void concurrentCallbacksCallTheGatewayOnce() throws Exception {
        String cookie = login();
        CheckoutResponse checkout = checkout(cookie);
        String state = param(checkout.successUrl(), "state");
        gateway.approveDelayMillis = 100;
        var pool = java.util.concurrent.Executors.newFixedThreadPool(6);
        try {
            List<java.util.concurrent.Future<?>> futures = new ArrayList<>();
            for (int i = 0; i < 6; i++) {
                futures.add(pool.submit(() -> success(cookie, state, checkout.customerKey(), AUTH_KEY)));
            }
            for (var future : futures) {
                future.get();
            }
        } finally {
            pool.shutdownNow();
        }
        assertThat(gateway.approvals).hasSize(1);
        assertThat(gateway.issued).hasSize(1);
    }

    @Test
    void callbackWithoutSessionOrWithForeignStateOrCustomerDoesNothing() {
        String cookie = login();
        CheckoutResponse checkout = checkout(cookie);
        String state = param(checkout.successUrl(), "state");

        // 쿠키 없음, 남의 쿠키
        assertThat(success(null, state, checkout.customerKey(), AUTH_KEY).getStatus()).isEqualTo(302);
        assertThat(success("forged", state, checkout.customerKey(), AUTH_KEY).getStatus()).isEqualTo(302);
        // state 불일치/누락
        success(cookie, "wrong", checkout.customerKey(), AUTH_KEY);
        assertThat(result(cookie).errorCode()).isEqualTo("state_mismatch");
        success(cookie, null, checkout.customerKey(), AUTH_KEY);
        assertThat(gateway.calls).isEmpty();
        // customerKey 불일치는 시도를 닫는다
        success(cookie, state, "pgr_other", AUTH_KEY);
        assertThat(result(cookie).errorCode()).isEqualTo("customer_mismatch");
        assertThat(result(cookie).status()).isEqualTo("failed");
        assertThat(gateway.calls).isEmpty();
        // 닫힌 시도는 올바른 값으로도 다시 쓸 수 없다
        success(cookie, state, checkout.customerKey(), AUTH_KEY);
        assertThat(gateway.calls).isEmpty();
    }

    @Test
    void anotherSessionCannotUseTheStateOfThisOne() {
        String owner = login();
        CheckoutResponse checkout = checkout(owner);
        String attacker = login();
        checkout(attacker);
        success(attacker, param(checkout.successUrl(), "state"), checkout.customerKey(), AUTH_KEY);
        assertThat(gateway.calls).isEmpty();
        assertThat(result(owner).status()).isEqualTo("idle");
    }

    @Test
    void expiredCheckoutIsNotProcessed() {
        String cookie = login();
        CheckoutResponse checkout = checkout(cookie);
        clock.advance(Duration.ofMinutes(16));
        success(cookie, param(checkout.successUrl(), "state"), checkout.customerKey(), AUTH_KEY);
        assertThat(result(cookie).errorCode()).isEqualTo("checkout_expired");
        assertThat(gateway.calls).isEmpty();
    }

    @Test
    void failCallbackRecordsOnlyASafeCodeAndNoRawMessage() {
        String cookie = login();
        CheckoutResponse checkout = checkout(cookie);
        MockHttpServletResponse response = new MockHttpServletResponse();
        controller.fail(param(checkout.failUrl(), "state"), "PAY_PROCESS_CANCELED", get(cookie), response);
        assertThat(response.getHeader("Location")).isEqualTo(ORIGIN + "/pg-review/result");
        assertThat(response.getHeader("Referrer-Policy")).isEqualTo("no-referrer");
        assertThat(response.getHeader("Cache-Control")).isEqualTo("no-store");
        PgReviewResult result = result(cookie);
        assertThat(result.status()).isEqualTo("failed");
        assertThat(result.errorCode()).isEqualTo("PAY_PROCESS_CANCELED");
        assertThat(result.message()).isEqualTo("카드 등록이 완료되지 않았습니다.");

        // 실패 뒤에는 다시 시도할 수 있다. 이상한 코드는 일반 코드로 바뀐다.
        CheckoutResponse retry = checkout(cookie);
        controller.fail(param(retry.failUrl(), "state"), "<script>alert(1)</script>", get(cookie), new MockHttpServletResponse());
        assertThat(result(cookie).errorCode()).isEqualTo("registration_failed");
        // state 가 틀린 fail 은 아무 효과가 없다
        CheckoutResponse third = checkout(cookie);
        controller.fail("wrong", "X", get(cookie), new MockHttpServletResponse());
        assertThat(result(cookie).status()).isEqualTo("idle");
        assertThat(third).isNotNull();
    }

    @Test
    void gatewayRejectionOfBillingKeyIsAFailureAndNeverApproves() {
        gateway.issueFailure = new GatewayException(GatewayException.Outcome.REJECTED, "INVALID_CARD_NUMBER");
        String cookie = login();
        CheckoutResponse checkout = checkout(cookie);
        success(cookie, param(checkout.successUrl(), "state"), checkout.customerKey(), AUTH_KEY);
        PgReviewResult result = result(cookie);
        assertThat(result.status()).isEqualTo("failed");
        assertThat(result.errorCode()).isEqualTo("INVALID_CARD_NUMBER");
        assertThat(gateway.approvals).isEmpty();
    }

    @Test
    void approvalRejectionIsFailedButTimeoutIsUnknownAndNeverCreatesAnotherOrder() {
        gateway.approveFailure = new GatewayException(GatewayException.Outcome.REJECTED, "REJECT_CARD_PAYMENT");
        String cookie = login();
        CheckoutResponse checkout = checkout(cookie);
        success(cookie, param(checkout.successUrl(), "state"), checkout.customerKey(), AUTH_KEY);
        assertThat(result(cookie).status()).isEqualTo("failed");

        // 실패 뒤에는 새 시도가 가능하다. 이번에는 시간 초과.
        gateway.approveFailure = new GatewayException(GatewayException.Outcome.UNKNOWN, "gateway_unreachable");
        CheckoutResponse second = checkout(cookie);
        success(cookie, param(second.successUrl(), "state"), second.customerKey(), AUTH_KEY);
        PgReviewResult unknown = result(cookie);
        assertThat(unknown.status()).isEqualTo("unknown");
        assertThat(unknown.orderId()).isNotBlank();
        // unknown 이면 자동 재시도도, 새 시도 발급도 없다.
        assertThat(statusOf(() -> checkout(cookie))).isEqualTo(409);
        success(cookie, param(second.successUrl(), "state"), second.customerKey(), AUTH_KEY);
        assertThat(gateway.approvals).hasSize(2);
    }

    @Test
    void mismatchedApprovalIsUnknownNotApproved() {
        for (PgReviewGateway.Approval wrong : List.of(
                new PgReviewGateway.Approval("DONE", "someone-else", 3900, "t"),
                new PgReviewGateway.Approval("DONE", null, 100, "t"),
                new PgReviewGateway.Approval("ABORTED", null, 3900, "t"))) {
            build(settings("test_sk_abcdefgh12345678"));
            gateway.forcedApproval = wrong;
            String cookie = login();
            CheckoutResponse checkout = checkout(cookie);
            success(cookie, param(checkout.successUrl(), "state"), checkout.customerKey(), AUTH_KEY);
            assertThat(result(cookie).status()).isEqualTo("unknown");
        }
        // 금액이 3900 이 아니면 서버가 직접 만든 요청이 아니다 — 가짜 게이트웨이도 금액을 되돌려 줄 뿐이다.
        assertThat(PgReviewResult.AMOUNT).isEqualTo(3900L);
    }

    @Test
    void unexpectedGatewayErrorBecomesUnknownAndStillRedirectsWithoutThrowing() {
        gateway.approveRuntime = new IllegalStateException("boom " + AUTH_KEY);
        String cookie = login();
        CheckoutResponse checkout = checkout(cookie);
        MockHttpServletResponse response = success(cookie, param(checkout.successUrl(), "state"), checkout.customerKey(), AUTH_KEY);
        assertThat(response.getStatus()).isEqualTo(302);
        assertThat(result(cookie).status()).isEqualTo("unknown");
        assertThat(result(cookie).errorCode()).isEqualTo("unexpected_error");
        assertNoSecretInLogs();
    }

    @Test
    void checkoutAttemptsPerSessionAreCapped() {
        String cookie = login();
        for (int i = 0; i < PgReviewSessions.MAX_CHECKOUTS_PER_SESSION; i++) {
            CheckoutResponse checkout = checkout(cookie);
            controller.fail(param(checkout.failUrl(), "state"), "X", get(cookie), new MockHttpServletResponse());
        }
        assertThat(statusOf(() -> checkout(cookie))).isEqualTo(409);
    }

    @Test
    void callbackBurstFromOneAddressIsThrottledWithoutCallingTheGateway() {
        String cookie = login();
        CheckoutResponse checkout = checkout(cookie);
        for (int i = 0; i < 30; i++) {
            success(cookie, "wrong", checkout.customerKey(), AUTH_KEY);
        }
        MockHttpServletResponse limited = success(cookie, param(checkout.successUrl(), "state"), checkout.customerKey(), AUTH_KEY);
        assertThat(limited.getStatus()).isEqualTo(302);
        assertThat(gateway.calls).isEmpty();
    }

    @Test
    void passwordFieldIsMarkedAsCredentialSoValidationErrorsDoNotEchoIt() {
        var component = LoginRequest.class.getRecordComponents()[1];
        assertThat(component.isAnnotationPresent(com.acttub.actingapi.platform.web.CredentialField.class)).isTrue();
    }

    private void assertNoSecretInLogs() {
        for (ILoggingEvent event : logs.list) {
            assertThat(event.getFormattedMessage()).doesNotContain(AUTH_KEY, BILLING_KEY, "test_sk_");
            if (event.getThrowableProxy() != null) {
                assertThat(event.getThrowableProxy().getMessage()).doesNotContain(AUTH_KEY, BILLING_KEY);
            }
        }
    }

    /** 토스를 대신하는 가짜. 호출을 기록하고 빌링키 값은 반환만 한다. */
    static final class FakeGateway implements PgReviewGateway {
        record Approve(String customerKey, String orderId, long amount, String orderName, String idempotencyKey) {
        }

        final List<String> calls = new ArrayList<>();
        final List<String> issued = new ArrayList<>();
        final List<Approve> approvals = new ArrayList<>();
        volatile GatewayException issueFailure;
        volatile GatewayException approveFailure;
        volatile RuntimeException approveRuntime;
        volatile Approval forcedApproval;
        volatile long approveDelayMillis;
        final AtomicInteger counter = new AtomicInteger();

        @Override
        public synchronized String issueBillingKey(String authKey, String customerKey) {
            calls.add("issue");
            if (issueFailure != null) {
                throw issueFailure;
            }
            issued.add(authKey + "|" + customerKey);
            return BILLING_KEY;
        }

        @Override
        public Approval approve(String billingKey, String customerKey, String orderId, long amount, String orderName,
                String idempotencyKey) {
            if (approveDelayMillis > 0) {
                try {
                    Thread.sleep(approveDelayMillis);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                }
            }
            synchronized (this) {
                calls.add("approve");
                approvals.add(new Approve(customerKey, orderId, amount, orderName, idempotencyKey));
            }
            assertThat(billingKey).isEqualTo(BILLING_KEY);
            if (approveRuntime != null) {
                throw approveRuntime;
            }
            if (approveFailure != null) {
                throw approveFailure;
            }
            if (forcedApproval != null) {
                return forcedApproval.orderId() == null
                        ? new Approval(forcedApproval.status(), orderId, forcedApproval.amount(), forcedApproval.approvedAt())
                        : forcedApproval;
            }
            return new Approval("DONE", orderId, amount, "2026-10-20T09:00:00+09:00");
        }
    }
}
