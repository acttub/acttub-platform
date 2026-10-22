package com.acttub.actingapi.feature.billing.adapter.web;

import com.acttub.actingapi.feature.billing.adapter.web.BillingDtos.CheckoutRequest;
import com.acttub.actingapi.feature.billing.adapter.web.BillingDtos.CheckoutResponse;
import com.acttub.actingapi.feature.billing.adapter.web.BillingDtos.MeResponse;
import com.acttub.actingapi.feature.billing.app.SubscriptionService;
import com.acttub.actingapi.platform.security.AccessGate;
import com.acttub.actingapi.platform.security.AuthenticatedUser;
import com.acttub.actingapi.platform.security.FixedWindowRateLimiter;
import com.acttub.actingapi.platform.web.ApiException;
import io.swagger.v3.oas.annotations.Hidden;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import org.springframework.http.HttpHeaders;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 앱 ACTTUB Pro 구독(SOMA-818, billing.subscription). 결제 기능이 닫혀 있으면 모든 경로가 404
 * {@code billing_unavailable} 이고 앱은 그것으로 Pro 진입점을 숨긴다. 실험 플래그 뒤의 기능이라 OpenAPI 에 싣지 않는다
 * ({@link Hidden}) — 계약은 specs/billing/subscription.md 가 정한다.
 *
 * <ul>
 *   <li>{@code GET /v2/billing/me} — 구독 상태와 Pro 권한(앱 화면 분기용)</li>
 *   <li>{@code POST /v2/billing/checkout} {@code {purpose: subscribe|change_card}} — 일회용 카드 등록 창 주소</li>
 *   <li>{@code POST /v2/billing/subscription/cancel} — 자동결제 해지(이번 기간 끝까지 Pro)</li>
 *   <li>{@code POST /v2/billing/subscription/retry} — 자동결제 실패 뒤 지금 다시 결제</li>
 * </ul>
 */
@Hidden
@RestController
@RequestMapping("/v2/billing")
class BillingController {
    private final SubscriptionService service;
    private final AccessGate auth;
    private final FixedWindowRateLimiter limiter;

    BillingController(SubscriptionService service, AccessGate auth, FixedWindowRateLimiter limiter) {
        this.service = service;
        this.auth = auth;
        this.limiter = limiter;
    }

    @GetMapping("/me")
    MeResponse me(HttpServletRequest request, HttpServletResponse response) {
        noStore(response);
        AuthenticatedUser user = auth.gatedUser(request);
        return MeResponse.of(service.view(user.id()));
    }

    @PostMapping("/checkout")
    CheckoutResponse checkout(@Valid @RequestBody(required = false) CheckoutRequest body, HttpServletRequest request,
            HttpServletResponse response) {
        noStore(response);
        AuthenticatedUser user = auth.gatedUser(request);
        throttle("billing-checkout:" + user.id(), 20);
        SubscriptionService.StartedCheckout started =
                service.startCheckout(user.id(), user.guest(), body == null ? null : body.purpose());
        return new CheckoutResponse(started.checkoutUrl(), started.returnUrl(), started.expiresAt());
    }

    @PostMapping("/subscription/cancel")
    MeResponse cancel(HttpServletRequest request, HttpServletResponse response) {
        noStore(response);
        AuthenticatedUser user = auth.gatedUser(request);
        throttle("billing-change:" + user.id(), 20);
        return MeResponse.of(service.cancel(user.id()));
    }

    @PostMapping("/subscription/retry")
    MeResponse retry(HttpServletRequest request, HttpServletResponse response) {
        noStore(response);
        AuthenticatedUser user = auth.gatedUser(request);
        throttle("billing-retry:" + user.id(), 5);
        return MeResponse.of(service.retry(user.id()));
    }

    private void throttle(String key, int limit) {
        if (!limiter.allow(key, limit)) {
            throw new ApiException(429, "rate limit exceeded");
        }
    }

    private static void noStore(HttpServletResponse response) {
        response.setHeader(HttpHeaders.CACHE_CONTROL, "no-store");
    }
}
