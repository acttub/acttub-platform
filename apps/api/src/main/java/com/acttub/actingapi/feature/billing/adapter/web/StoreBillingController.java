package com.acttub.actingapi.feature.billing.adapter.web;

import java.util.Map;

import com.acttub.actingapi.feature.billing.adapter.store.RevenueCatWebhookAuth;
import com.acttub.actingapi.feature.billing.adapter.web.BillingDtos.MeResponse;
import com.acttub.actingapi.feature.billing.app.StoreBillingService;
import com.acttub.actingapi.feature.billing.app.StoreGateways.StoreException;
import com.acttub.actingapi.platform.security.AccessGate;
import com.acttub.actingapi.platform.security.AuthenticatedUser;
import com.acttub.actingapi.platform.security.FixedWindowRateLimiter;
import com.acttub.actingapi.platform.web.ApiException;
import com.fasterxml.jackson.databind.JsonNode;
import io.swagger.v3.oas.annotations.Hidden;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.HttpHeaders;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 앱 스토어 구독(SOMA-818 2단계, RevenueCat). 실험 플래그 뒤의 기능이라 OpenAPI 에 싣지 않는다({@link Hidden}).
 *
 * <ul>
 *   <li>{@code POST /v2/billing/store/sync} — 로그인한 앱이 구매·복원 뒤 부른다. 서버가 RevenueCat 에서 상태를 다시 읽어 반영한다</li>
 *   <li>{@code POST /v2/billing/store-notify/revenuecat} — RevenueCat 웹훅(Authorization 헤더가 권한)</li>
 * </ul>
 */
@Hidden
@RestController
@RequestMapping("/v2/billing")
class StoreBillingController {
    private final StoreBillingService service;
    private final AccessGate auth;
    private final FixedWindowRateLimiter limiter;
    private final RevenueCatWebhookAuth webhookAuth;

    StoreBillingController(StoreBillingService service, AccessGate auth, FixedWindowRateLimiter limiter,
            RevenueCatWebhookAuth webhookAuth) {
        this.service = service;
        this.auth = auth;
        this.limiter = limiter;
        this.webhookAuth = webhookAuth;
    }

    /** 본문은 없다(있어도 읽지 않는다). 누구의 구독인지는 토큰의 사용자가 정한다. */
    @PostMapping("/store/sync")
    MeResponse sync(HttpServletRequest request, HttpServletResponse response) {
        response.setHeader(HttpHeaders.CACHE_CONTROL, "no-store");
        AuthenticatedUser user = auth.gatedUser(request);
        if (!limiter.allow("billing-store-sync:" + user.id(), 30)) {
            throw new ApiException(429, "rate limit exceeded");
        }
        return MeResponse.of(service.sync(user.id(), user.guest()));
    }

    /**
     * RevenueCat 웹훅. 헤더가 틀리면 401(RevenueCat 이 다시 보내도 소용없음), 본문 꼴이 틀리면 400, RevenueCat 조회 실패면 5xx 로
     * 돌려 RevenueCat 이 다시 보내게 한다.
     */
    @PostMapping("/store-notify/revenuecat")
    Map<String, String> revenueCat(@RequestBody(required = false) JsonNode body, HttpServletRequest request) {
        if (!webhookAuth.accepts(request.getHeader(HttpHeaders.AUTHORIZATION))) {
            throw new ApiException(401, "unauthorized");
        }
        try {
            return Map.of("result", service.handleRevenueCatEvent(body).name().toLowerCase());
        } catch (StoreException failure) {
            throw switch (failure.kind()) {
                case INVALID -> new ApiException(400, "invalid_notification");
                case UNAVAILABLE -> ApiException.external(503, "store_unavailable", failure);
                case UPSTREAM -> ApiException.external(502, "store_upstream_error", failure);
            };
        }
    }
}
