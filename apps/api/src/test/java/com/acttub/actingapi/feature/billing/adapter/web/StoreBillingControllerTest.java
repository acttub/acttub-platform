package com.acttub.actingapi.feature.billing.adapter.web;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.Map;
import java.util.UUID;

import com.acttub.actingapi.feature.billing.adapter.store.GooglePushAuth;
import com.acttub.actingapi.feature.billing.adapter.web.StoreBillingController.AppleNotificationRequest;
import com.acttub.actingapi.feature.billing.adapter.web.StoreBillingController.VerifyRequest;
import com.acttub.actingapi.feature.billing.app.StoreBillingService;
import com.acttub.actingapi.feature.billing.app.StoreBillingService.NotificationResult;
import com.acttub.actingapi.feature.billing.app.StoreGateways.StoreException;
import com.acttub.actingapi.platform.security.AccessGate;
import com.acttub.actingapi.platform.security.AuthenticatedUser;
import com.acttub.actingapi.platform.security.FixedWindowRateLimiter;
import com.acttub.actingapi.platform.web.ApiException;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

/** 스토어 알림 엔드포인트의 인증·오류 변환(SOMA-818 2단계). 서비스 규칙은 StoreBillingServiceTest 가 본다. */
class StoreBillingControllerTest {
    final StoreBillingService service = mock(StoreBillingService.class);
    final AccessGate gate = mock(AccessGate.class);
    final FixedWindowRateLimiter limiter = mock(FixedWindowRateLimiter.class);
    final GooglePushAuth push = new GooglePushAuth("token", "secret-1", "", "", null);
    final StoreBillingController controller = new StoreBillingController(service, gate, limiter, push);

    static String data() {
        return Base64.getEncoder().encodeToString("{}".getBytes(StandardCharsets.UTF_8));
    }

    @Test
    void googlePushNeedsTheSecretAndAMessage() {
        MockHttpServletRequest request = new MockHttpServletRequest();
        assertThatThrownBy(() -> controller.google(Map.of("message", Map.of("data", data())), "wrong", request))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.status()).isEqualTo(401));
        assertThatThrownBy(() -> controller.google(Map.of("message", Map.of()), "secret-1", request))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.status()).isEqualTo(400));
        when(service.handleGoogleNotification(data())).thenReturn(NotificationResult.APPLIED);
        assertThat(controller.google(Map.of("message", Map.of("data", data())), "secret-1", request)).containsEntry("result", "applied");
    }

    @Test
    void notificationFailuresBecomeRetryableOrFinalStatuses() {
        when(service.handleAppleNotification("forged")).thenThrow(new StoreException(StoreException.Kind.INVALID, "x"));
        when(service.handleAppleNotification("down")).thenThrow(new StoreException(StoreException.Kind.UPSTREAM, "x"));
        when(service.handleAppleNotification("off")).thenThrow(new StoreException(StoreException.Kind.UNAVAILABLE, "x"));
        assertThatThrownBy(() -> controller.apple(new AppleNotificationRequest("forged")))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.status()).isEqualTo(400));
        assertThatThrownBy(() -> controller.apple(new AppleNotificationRequest("down")))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.status()).isEqualTo(502));
        assertThatThrownBy(() -> controller.apple(new AppleNotificationRequest("off")))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.status()).isEqualTo(503));
        when(service.handleAppleNotification("ok")).thenReturn(NotificationResult.IGNORED);
        assertThat(controller.apple(new AppleNotificationRequest("ok"))).containsEntry("result", "ignored");
    }

    @Test
    void verifyIsRateLimitedPerUser() {
        AuthenticatedUser user = mock(AuthenticatedUser.class);
        when(user.id()).thenReturn(UUID.randomUUID());
        MockHttpServletRequest request = new MockHttpServletRequest();
        when(gate.gatedUser(request)).thenReturn(user);
        when(limiter.allow(anyString(), anyInt())).thenReturn(false);
        assertThatThrownBy(() -> controller.verify(new VerifyRequest("ios", null, "jws", null), request, new MockHttpServletResponse()))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.status()).isEqualTo(429));
    }
}
