package com.acttub.actingapi.auth;

import com.acttub.actingapi.web.ApiException;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.stereotype.Service;

/** Python app.py의 current/optional/rate-limited/consented 네 조합을 이름 그대로 제공한다. */
@Service
public class AuthDependencies {
    private static final String RATE_LIMITED_ATTRIBUTE =
            AuthDependencies.class.getName() + ".rateLimitedUser";
    private static final String CONSENTED_ATTRIBUTE =
            AuthDependencies.class.getName() + ".consentedUser";

    private final CurrentUserService current;
    private final FixedWindowRateLimiter limiter;
    private final AuthStore store;

    public AuthDependencies(
            CurrentUserService current,
            FixedWindowRateLimiter limiter,
            AuthStore store) {
        this.current = current;
        this.limiter = limiter;
        this.store = store;
    }

    public AuthStore.User currentUser(HttpServletRequest request) {
        return current.require(request);
    }

    public AuthStore.User optionalUser(HttpServletRequest request) {
        return current.optional(request);
    }

    public AuthStore.User rateLimitedUser(HttpServletRequest request) {
        if (request != null
                && request.getAttribute(RATE_LIMITED_ATTRIBUTE) instanceof AuthStore.User user) {
            return user;
        }
        AuthStore.User user = currentUser(request);
        if (!limiter.allow(user.id().toString(), 60)) {
            throw new ApiException(429, "rate limit exceeded");
        }
        if (request != null) {
            request.setAttribute(RATE_LIMITED_ATTRIBUTE, user);
        }
        return user;
    }

    public AuthStore.User consentedUser(HttpServletRequest request) {
        if (request != null
                && request.getAttribute(CONSENTED_ATTRIBUTE) instanceof AuthStore.User user) {
            return user;
        }
        AuthStore.User user = rateLimitedUser(request);
        if (store.hasPendingConsents(user.id())) {
            throw new ApiException(403, "consent_required");
        }
        if (request != null) {
            request.setAttribute(CONSENTED_ATTRIBUTE, user);
        }
        return user;
    }
}
