package com.acttub.actingapi.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.UUID;

import com.acttub.actingapi.schema.UserStatus;
import com.acttub.actingapi.web.ApiException;
import jakarta.servlet.http.HttpServletRequest;
import org.junit.jupiter.api.Test;

class AuthDependenciesTest {
    @Test
    void fourCompositionsPreserveOptionalRateAndConsentSemantics() {
        var user = new AuthenticatedUser(UUID.randomUUID(), null, UserStatus.ACTIVE);
        CurrentUserService current = new CurrentUserService(null, null) {
            @Override
            public AuthenticatedUser optional(HttpServletRequest request) {
                return null;
            }

            @Override
            public AuthenticatedUser require(HttpServletRequest request) {
                return user;
            }
        };
        // 사용자를 어디서 읽어오는지 이 검사는 모른다 — 게이트가 auth 없이 선다는 것이
        // 세 갈래 분해의 실증이다 (SOMA-397 7단계).
        AuthenticatedUsers users = new AuthenticatedUsers() {
            @Override
            public AuthenticatedUser find(UUID id) {
                return user;
            }

            @Override
            public boolean hasPendingConsents(UUID ignored) {
                return true;
            }
        };
        HttpServletRequest request = null;
        FixedWindowRateLimiter limiter = new FixedWindowRateLimiter(() -> 1L);
        AccessGate dependencies = new AccessGate(current, limiter, users);

        assertThat(dependencies.optionalUser(request)).isNull();
        assertThat(dependencies.currentUser(request)).isEqualTo(user);
        assertThat(dependencies.rateLimitedUser(request)).isEqualTo(user);
        assertThatThrownBy(() -> dependencies.consentedUser(request))
                .isInstanceOf(ApiException.class)
                .hasMessage("consent_required");

        assertThat(ConsentGateInterceptor.requiresConsent("POST", "/v2/uploads/intents"))
                .isTrue();
        assertThat(ConsentGateInterceptor.requiresConsent(
                "POST", "/v2/community/posts/id/comments"))
                .isTrue();
        assertThat(ConsentGateInterceptor.requiresConsent(
                "GET", "/v2/community/posts/id/comments"))
                .isFalse();
        assertThat(ConsentGateInterceptor.requiresConsent(
                "DELETE", "/v2/practice-sessions/id"))
                .isFalse();
    }
}
