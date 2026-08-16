package com.acttub.actingapi.security;

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
    private final AuthenticatedUsers users;

    public AuthDependencies(
            CurrentUserService current,
            FixedWindowRateLimiter limiter,
            AuthenticatedUsers users) {
        this.current = current;
        this.limiter = limiter;
        this.users = users;
    }

    public AuthenticatedUser currentUser(HttpServletRequest request) {
        return current.require(request);
    }

    public AuthenticatedUser optionalUser(HttpServletRequest request) {
        return current.optional(request);
    }

    public AuthenticatedUser rateLimitedUser(HttpServletRequest request) {
        if (request != null
                && request.getAttribute(RATE_LIMITED_ATTRIBUTE) instanceof AuthenticatedUser user) {
            return user;
        }
        AuthenticatedUser user = currentUser(request);
        if (!limiter.allow(user.id().toString(), 60)) {
            throw new ApiException(429, "rate limit exceeded");
        }
        if (request != null) {
            request.setAttribute(RATE_LIMITED_ATTRIBUTE, user);
        }
        return user;
    }

    public AuthenticatedUser consentedUser(HttpServletRequest request) {
        if (request != null
                && request.getAttribute(CONSENTED_ATTRIBUTE) instanceof AuthenticatedUser user) {
            return user;
        }
        AuthenticatedUser user = rateLimitedUser(request);
        if (users.hasPendingConsents(user.id())) {
            throw new ApiException(403, "consent_required");
        }
        if (request != null) {
            request.setAttribute(CONSENTED_ATTRIBUTE, user);
        }
        return user;
    }
}
