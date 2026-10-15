package com.acttub.actingapi.feature.billing.adapter.web;

import java.time.Duration;
import java.util.Optional;

import com.acttub.actingapi.feature.billing.adapter.web.PgReviewDtos.CheckoutResponse;
import com.acttub.actingapi.feature.billing.adapter.web.PgReviewDtos.ConfigResponse;
import com.acttub.actingapi.feature.billing.adapter.web.PgReviewDtos.LoginRequest;
import com.acttub.actingapi.feature.billing.adapter.web.PgReviewDtos.LoginResponse;
import com.acttub.actingapi.feature.billing.app.PgReviewResult;
import com.acttub.actingapi.feature.billing.app.PgReviewService;
import com.acttub.actingapi.feature.billing.app.PgReviewSessions;
import com.acttub.actingapi.feature.billing.app.PgReviewSessions.Checkout;
import com.acttub.actingapi.feature.billing.app.PgReviewSessions.Session;
import com.acttub.actingapi.platform.security.ClientAddress;
import com.acttub.actingapi.platform.security.FixedWindowRateLimiter;
import com.acttub.actingapi.platform.web.ApiException;
import io.swagger.v3.oas.annotations.Hidden;
import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * PG 심사 전용 테스트 결제 API(SOMA-620). 실제 앱 계정·JWT·유료 권한과 무관한 <b>별도 쿠키 세션</b>을 쓰며,
 * 게이트(클라이언트 판·동의·액세스 토큰)에서 이 경로를 뺐다(토스가 브라우저를 되돌려 보내는 콜백은 우리
 * 헤더를 실을 수 없다). 설정이 꺼져 있으면 빈이 없어 모든 경로가 404 다. 공개 OpenAPI 에는 싣지 않는다.
 *
 * <p>콜백({@code /success}, {@code /fail})은 쿼리의 authKey 를 메모리에서만 쓰고, 어떤 결과든 깨끗한 결과 주소로
 * 302 로 돌려보낸다. 예외를 던지지 않으므로 authKey 가 담긴 URL 이 오류 수집에 실리지 않는다.
 */
@Hidden
@RestController
@RequestMapping("/v2/pg-review")
@ConditionalOnProperty(name = "ACTTUB_PG_REVIEW_ENABLED", havingValue = "true")
class PgReviewController {
    static final String COOKIE = "acttub_pg_review";
    static final String RESULT_PATH = "/pg-review/result";
    private static final String BASE = "/v2/pg-review";

    private final PgReviewService service;
    private final FixedWindowRateLimiter limiter;
    private final ClientAddress addresses;

    PgReviewController(PgReviewService service, FixedWindowRateLimiter limiter, ClientAddress addresses) {
        this.service = service;
        this.limiter = limiter;
        this.addresses = addresses;
    }

    @GetMapping("/config")
    ConfigResponse config(HttpServletRequest request, HttpServletResponse response) {
        noStore(response);
        throttleReads(request);
        boolean authenticated = service.authenticate(sessionId(request)).isPresent();
        return new ConfigResponse(service.available(), authenticated, true, PgReviewResult.AMOUNT);
    }

    @PostMapping("/login")
    LoginResponse login(
            @Valid @RequestBody LoginRequest body, HttpServletRequest request, HttpServletResponse response) {
        noStore(response);
        requireOrigin(request);
        requireAvailable();
        String ip = addresses.of(request);
        if (!limiter.allow("pg-review-login-all", 60)) {
            throw tooMany();
        }
        // 틀린 시도만 센다: 자리를 먼저 잡고 맞으면 돌려준다.
        FixedWindowRateLimiter.Reservation attempt = limiter.reserve("pg-review-login:" + ip, 10);
        if (attempt == null) {
            throw tooMany();
        }
        // 세션 고정 공격을 막으려고 이전 세션은 항상 닫고 새 값을 발급한다.
        service.logout(sessionId(request));
        Optional<Session> session;
        try {
            session = service.login(body.username(), body.password());
        } catch (PgReviewService.LoginFull full) {
            attempt.release();
            throw sessionLimit();
        }
        if (session.isEmpty()) {
            throw invalidCredentials();
        }
        attempt.release();
        response.addHeader(HttpHeaders.SET_COOKIE, cookie(session.get().id(), PgReviewSessions.SESSION_TTL));
        return new LoginResponse(true);
    }

    @PostMapping("/checkout")
    CheckoutResponse checkout(HttpServletRequest request, HttpServletResponse response) {
        noStore(response);
        requireOrigin(request);
        Session session = requireSession(request);
        if (!limiter.allow("pg-review-checkout:" + addresses.of(request), 20)) {
            throw tooMany();
        }
        Checkout checkout = service.checkout(session).orElseThrow(PgReviewController::checkoutNotAllowed);
        String origin = service.settings().origin();
        return new CheckoutResponse(
                service.settings().clientKey(),
                checkout.customerKey(),
                origin + BASE + "/success?state=" + checkout.state(),
                origin + BASE + "/fail?state=" + checkout.state());
    }

    @GetMapping("/success")
    void success(
            @RequestParam(name = "state", required = false) String state,
            @RequestParam(name = "customerKey", required = false) String customerKey,
            @RequestParam(name = "authKey", required = false) String authKey,
            HttpServletRequest request,
            HttpServletResponse response) {
        try {
            if (service.available() && limiter.allow("pg-review-callback:" + addresses.of(request), 30)) {
                service.authenticate(sessionId(request))
                        .ifPresent(session -> service.completeRegistration(session, state, customerKey, authKey));
            }
        } catch (RuntimeException unexpected) {
            // 아무것도 싣지 않는다. 서비스가 이미 결과를 기록했고, 결과 주소가 세션의 기록을 보여 준다.
        }
        redirectToResult(response);
    }

    @GetMapping("/fail")
    void fail(
            @RequestParam(name = "state", required = false) String state,
            @RequestParam(name = "code", required = false) String code,
            HttpServletRequest request,
            HttpServletResponse response) {
        try {
            if (service.available() && limiter.allow("pg-review-callback:" + addresses.of(request), 30)) {
                service.authenticate(sessionId(request))
                        .ifPresent(session -> service.failRegistration(session, state, code));
            }
        } catch (RuntimeException unexpected) {
            // 위와 같다.
        }
        redirectToResult(response);
    }

    @GetMapping("/result")
    PgReviewResult result(HttpServletRequest request, HttpServletResponse response) {
        noStore(response);
        throttleReads(request);
        return requireSession(request).result();
    }

    @PostMapping("/logout")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void logout(HttpServletRequest request, HttpServletResponse response) {
        noStore(response);
        requireOrigin(request);
        service.logout(sessionId(request));
        response.addHeader(HttpHeaders.SET_COOKIE, cookie("", Duration.ZERO));
    }

    private void redirectToResult(HttpServletResponse response) {
        noStore(response);
        response.setHeader("Referrer-Policy", "no-referrer");
        response.setStatus(HttpServletResponse.SC_FOUND);
        response.setHeader(HttpHeaders.LOCATION, service.settings().origin() + RESULT_PATH);
    }

    private String cookie(String value, Duration maxAge) {
        StringBuilder header = new StringBuilder(COOKIE).append('=').append(value)
                .append("; Max-Age=").append(maxAge.toSeconds())
                .append("; Path=").append(BASE)
                .append("; HttpOnly; SameSite=Lax");
        if (service.settings().secureCookie()) {
            header.append("; Secure");
        }
        return header.toString();
    }

    private static String sessionId(HttpServletRequest request) {
        Cookie[] cookies = request.getCookies();
        if (cookies == null) {
            return null;
        }
        for (Cookie cookie : cookies) {
            if (COOKIE.equals(cookie.getName())) {
                return cookie.getValue();
            }
        }
        return null;
    }

    private Session requireSession(HttpServletRequest request) {
        requireAvailable();
        return service.authenticate(sessionId(request)).orElseThrow(PgReviewController::loginRequired);
    }

    private void requireAvailable() {
        if (!service.available()) {
            throw unavailable();
        }
    }

    /** 브라우저가 보낸 POST 는 Origin 이 설정한 origin 과 정확히 같아야 한다. 없거나 다르면 거절한다. */
    private void requireOrigin(HttpServletRequest request) {
        if (!service.settings().origin().equals(request.getHeader(HttpHeaders.ORIGIN))) {
            throw originNotAllowed();
        }
    }

    private void throttleReads(HttpServletRequest request) {
        if (!limiter.allow("pg-review-read:" + addresses.of(request), 120)) {
            throw tooMany();
        }
    }

    private static void noStore(HttpServletResponse response) {
        response.setHeader(HttpHeaders.CACHE_CONTROL, "no-store");
    }

    private static ApiException unavailable() {
        return new ApiException(404, "pg_review_unavailable");
    }

    private static ApiException invalidCredentials() {
        return new ApiException(401, "invalid_credentials");
    }

    private static ApiException loginRequired() {
        return new ApiException(401, "pg_review_login_required");
    }

    private static ApiException originNotAllowed() {
        return new ApiException(403, "origin_not_allowed");
    }

    private static ApiException checkoutNotAllowed() {
        return new ApiException(409, "checkout_not_allowed");
    }

    private static ApiException tooMany() {
        return new ApiException(429, "rate limit exceeded");
    }

    private static ApiException sessionLimit() {
        return new ApiException(429, "pg_review_session_limit");
    }
}
