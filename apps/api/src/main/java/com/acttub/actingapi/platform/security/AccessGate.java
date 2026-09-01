package com.acttub.actingapi.platform.security;

import com.acttub.actingapi.platform.web.ApiException;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.stereotype.Service;

/** Python app.py의 current/optional/rate-limited/consented 네 조합을 이름 그대로 제공한다. */
@Service
public class AccessGate {
    private static final String RATE_LIMITED_ATTRIBUTE =
            AccessGate.class.getName() + ".rateLimitedUser";
    private static final String CONSENTED_ATTRIBUTE =
            AccessGate.class.getName() + ".consentedUser";

    private final CurrentUserService current;
    private final FixedWindowRateLimiter limiter;
    private final RequiredConsentGate consents;

    public AccessGate(
            CurrentUserService current,
            FixedWindowRateLimiter limiter,
            RequiredConsentGate consents) {
        this.current = current;
        this.limiter = limiter;
        this.consents = consents;
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
        RequiredConsentGate.Status status = consents.statusFor(user.id());
        if (status == RequiredConsentGate.Status.BLOCKED
                && request != null
                && "1".equals(request.getHeader("X-Acttub-Consent-Entry"))) {
            throw new ApiException(403, "consent_blocked");
        }
        if (status != RequiredConsentGate.Status.ALLOWED) {
            throw new ApiException(403, "consent_required");
        }
        if (request != null) {
            request.setAttribute(CONSENTED_ATTRIBUTE, user);
        }
        return user;
    }
}
