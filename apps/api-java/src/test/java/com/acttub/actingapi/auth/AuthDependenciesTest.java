package com.acttub.actingapi.auth;

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
        var user = new AuthStore.User(UUID.randomUUID(), null, UserStatus.ACTIVE);
        CurrentUserService current = new CurrentUserService(null, null) {
            @Override
            public AuthStore.User optional(HttpServletRequest request) {
                return null;
            }

            @Override
            public AuthStore.User require(HttpServletRequest request) {
                return user;
            }
        };
        AuthStore store = new AuthStore(null, null) {
            @Override
            public boolean hasPendingConsents(UUID ignored) {
                return true;
            }
        };
        HttpServletRequest request = null;
        FixedWindowRateLimiter limiter = new FixedWindowRateLimiter(() -> 1L);
        AuthDependencies dependencies = new AuthDependencies(current, limiter, store);

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
