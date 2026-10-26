package com.acttub.actingapi.feature.billing.adapter.web;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.UUID;

import com.acttub.actingapi.feature.billing.adapter.store.RevenueCatWebhookAuth;
import com.acttub.actingapi.feature.billing.app.StoreBillingService;
import com.acttub.actingapi.feature.billing.app.StoreBillingService.NotificationResult;
import com.acttub.actingapi.feature.billing.app.StoreGateways.StoreException;
import com.acttub.actingapi.platform.security.AccessGate;
import com.acttub.actingapi.platform.security.AuthenticatedUser;
import com.acttub.actingapi.platform.security.FixedWindowRateLimiter;
import com.acttub.actingapi.platform.web.ApiException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

/** RevenueCat 웹훅의 인증·오류 변환과 동기화 요청 제한(SOMA-818 2단계). 서비스 규칙은 StoreBillingServiceTest 가 본다. */
class StoreBillingControllerTest {
    static final String SECRET = "Bearer rc-webhook-secret";
    final StoreBillingService service = mock(StoreBillingService.class);
    final AccessGate gate = mock(AccessGate.class);
    final FixedWindowRateLimiter limiter = mock(FixedWindowRateLimiter.class);
    final StoreBillingController controller = new StoreBillingController(service, gate, limiter, new RevenueCatWebhookAuth(SECRET));
    final JsonNode body = new ObjectMapper().createObjectNode().set("event", new ObjectMapper().createObjectNode().put("type", "RENEWAL"));

    static MockHttpServletRequest withAuth(String value) {
        MockHttpServletRequest request = new MockHttpServletRequest("POST", "/v2/billing/store-notify/revenuecat");
        if (value != null) {
            request.addHeader("Authorization", value);
        }
        return request;
    }

    @Test
    void webhookRejectsMissingOrWrongAuthorizationBeforeTouchingTheService() {
        for (String wrong : new String[] {null, "", "Bearer rc-webhook-secreT", "rc-webhook-secret", SECRET + "x"}) {
            assertThatThrownBy(() -> controller.revenueCat(body, withAuth(wrong)))
                    .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.status()).isEqualTo(401));
        }
        verify(service, never()).handleRevenueCatEvent(any());
    }

    @Test
    void webhookAcceptsTheExactHeader() {
        when(service.handleRevenueCatEvent(body)).thenReturn(NotificationResult.APPLIED);
        assertThat(controller.revenueCat(body, withAuth(SECRET))).containsEntry("result", "applied");
    }

    @Test
    void emptyWebhookSecretRejectsEverything() {
        RevenueCatWebhookAuth none = new RevenueCatWebhookAuth("  ");
        assertThat(none.configured()).isFalse();
        assertThat(none.accepts("")).isFalse();
        assertThat(none.accepts("Bearer anything")).isFalse();
        StoreBillingController closed = new StoreBillingController(service, gate, limiter, none);
        assertThatThrownBy(() -> closed.revenueCat(body, withAuth("Bearer anything")))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.status()).isEqualTo(401));
    }

    @Test
    void webhookFailuresBecomeRetryableOrFinalStatuses() {
        MockHttpServletRequest ok = withAuth(SECRET);
        when(service.handleRevenueCatEvent(body)).thenThrow(new StoreException(StoreException.Kind.INVALID, "x"));
        assertThatThrownBy(() -> controller.revenueCat(body, ok))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.status()).isEqualTo(400));
        JsonNode down = new ObjectMapper().createObjectNode().put("down", 1);
        when(service.handleRevenueCatEvent(down)).thenThrow(new StoreException(StoreException.Kind.UPSTREAM, "x"));
        assertThatThrownBy(() -> controller.revenueCat(down, ok))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.status()).isEqualTo(502));
        JsonNode off = new ObjectMapper().createObjectNode().put("x", 1);
        when(service.handleRevenueCatEvent(off)).thenThrow(new StoreException(StoreException.Kind.UNAVAILABLE, "x"));
        assertThatThrownBy(() -> controller.revenueCat(off, ok))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.status()).isEqualTo(503));
    }

    @Test
    void syncIsRateLimitedPerUser() {
        AuthenticatedUser user = mock(AuthenticatedUser.class);
        when(user.id()).thenReturn(UUID.randomUUID());
        MockHttpServletRequest request = new MockHttpServletRequest();
        when(gate.gatedUser(request)).thenReturn(user);
        when(limiter.allow(anyString(), anyInt())).thenReturn(false);
        assertThatThrownBy(() -> controller.sync(request, new MockHttpServletResponse()))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.status()).isEqualTo(429));
        verify(service, never()).sync(any(), org.mockito.ArgumentMatchers.anyBoolean());
    }
}
