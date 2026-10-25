package com.acttub.actingapi.feature.billing.adapter.web;

import java.util.Map;

import com.acttub.actingapi.feature.billing.adapter.store.GooglePushAuth;
import com.acttub.actingapi.feature.billing.adapter.web.BillingDtos.MeResponse;
import com.acttub.actingapi.feature.billing.app.StoreBillingService;
import com.acttub.actingapi.feature.billing.app.StoreGateways.StoreException;
import com.acttub.actingapi.platform.security.AccessGate;
import com.acttub.actingapi.platform.security.AuthenticatedUser;
import com.acttub.actingapi.platform.security.FixedWindowRateLimiter;
import com.acttub.actingapi.platform.web.ApiException;
import com.fasterxml.jackson.annotation.JsonProperty;
import io.swagger.v3.oas.annotations.Hidden;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import org.springframework.http.HttpHeaders;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * 앱 스토어 구독(SOMA-818 2단계, billing.store). 실험 플래그 뒤의 기능이라 OpenAPI 에 싣지 않는다({@link Hidden}).
 *
 * <ul>
 *   <li>{@code POST /v2/billing/store/verify} — 로그인한 앱이 구매 뒤 거래 JWS·구매 토큰을 보내 Pro 를 켠다</li>
 *   <li>{@code POST /v2/billing/store-notify/apple} — App Store Server Notifications V2(서명이 권한)</li>
 *   <li>{@code POST /v2/billing/store-notify/google} — Google RTDN Pub/Sub 푸시(비밀 토큰 또는 OIDC 가 권한)</li>
 * </ul>
 */
@Hidden
@RestController
@RequestMapping("/v2/billing")
class StoreBillingController {
    private final StoreBillingService service;
    private final AccessGate auth;
    private final FixedWindowRateLimiter limiter;
    private final GooglePushAuth pushAuth;

    StoreBillingController(StoreBillingService service, AccessGate auth, FixedWindowRateLimiter limiter,
            GooglePushAuth pushAuth) {
        this.service = service;
        this.auth = auth;
        this.limiter = limiter;
        this.pushAuth = pushAuth;
    }

    record VerifyRequest(
            @NotBlank @Size(max = 16) String platform,
            @JsonProperty("product_id") @Size(max = 128) String productId,
            @JsonProperty("signed_transaction") @Size(max = 20000) String signedTransaction,
            @JsonProperty("purchase_token") @Size(max = 4096) String purchaseToken) {
    }

    record AppleNotificationRequest(@JsonProperty("signedPayload") @NotBlank @Size(max = 100000) String signedPayload) {
    }

    @PostMapping("/store/verify")
    MeResponse verify(@Valid @RequestBody VerifyRequest body, HttpServletRequest request, HttpServletResponse response) {
        response.setHeader(HttpHeaders.CACHE_CONTROL, "no-store");
        AuthenticatedUser user = auth.gatedUser(request);
        if (!limiter.allow("billing-store-verify:" + user.id(), 30)) {
            throw new ApiException(429, "rate limit exceeded");
        }
        return MeResponse.of(service.verify(user.id(), user.guest(), body.platform(), body.productId(),
                body.signedTransaction(), body.purchaseToken()));
    }

    @PostMapping("/store-notify/apple")
    Map<String, String> apple(@Valid @RequestBody AppleNotificationRequest body) {
        try {
            return Map.of("result", service.handleAppleNotification(body.signedPayload()).name().toLowerCase());
        } catch (StoreException failure) {
            throw notificationFailure(failure);
        }
    }

    /** Pub/Sub 푸시 본문: {@code {"message":{"data":"<base64>","messageId":"..."},"subscription":"..."}}. */
    @PostMapping("/store-notify/google")
    Map<String, String> google(@RequestBody Map<String, Object> body, @RequestParam(name = "token", required = false) String token,
            HttpServletRequest request) {
        if (!pushAuth.accepts(token, request.getHeader(HttpHeaders.AUTHORIZATION))) {
            throw new ApiException(401, "unauthorized");
        }
        Object message = body.get("message");
        Object data = message instanceof Map<?, ?> map ? map.get("data") : null;
        if (!(data instanceof String encoded) || encoded.isBlank() || encoded.length() > 100000) {
            throw new ApiException(400, "invalid_notification");
        }
        try {
            return Map.of("result", service.handleGoogleNotification(encoded).name().toLowerCase());
        } catch (StoreException failure) {
            throw notificationFailure(failure);
        }
    }

    /** 서명·형식이 틀리면 4xx(다시 보내도 소용없음), 스토어 조회 실패면 5xx(다시 보내야 함). */
    private static ApiException notificationFailure(StoreException failure) {
        return switch (failure.kind()) {
            case INVALID -> new ApiException(400, "invalid_notification");
            case UNAVAILABLE -> ApiException.external(503, "store_unavailable", failure);
            case UPSTREAM -> ApiException.external(502, "store_upstream_error", failure);
        };
    }
}
