package com.acttub.actingapi.platform.security;

import java.util.List;

import com.acttub.actingapi.platform.web.ApiException;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.stereotype.Component;

/**
 * 요청 주체를 얻는 네 단계. 뒤의 것이 앞의 것을 포함한다.
 *
 * <ol>
 *   <li>{@link #currentUser} — 토큰이 멀쩡하고 계정을 쓸 수 있다.</li>
 *   <li>{@link #rateLimitedUser} — 분당 60회 안이다. <b>게이트 밖</b>의 기능(동의 조회·제출, 내 계정
 *       조회, 탈퇴)이 여기까지 본다.</li>
 *   <li>{@link #consentedUser} — 현재 판 동의 문서를 모두 결정했다. 프로필 입력이 여기까지 본다 —
 *       개인정보를 받기 전에 수집 동의가 끝나 있어야 한다.</li>
 *   <li>{@link #gatedUser} — 프로필 필수 항목까지 채웠다. <b>보호 기능</b> 전부가 여기를 지난다.</li>
 * </ol>
 *
 * <p>게이트는 요청마다 DB 의 상태로 판정한다. 같은 요청 안에서는 한 번만 묻는다.
 */
@Component
public class AccessGate {
    private static final String RATE_LIMITED_ATTRIBUTE = AccessGate.class.getName() + ".rateLimited";
    private static final String CONSENTED_ATTRIBUTE = AccessGate.class.getName() + ".consented";
    private static final String GATED_ATTRIBUTE = AccessGate.class.getName() + ".gated";

    private final CurrentUserService current;
    private final FixedWindowRateLimiter limiter;
    private final PendingConsentGate consents;
    private final ProfileGate profiles;

    public AccessGate(
            CurrentUserService current,
            FixedWindowRateLimiter limiter,
            PendingConsentGate consents,
            ProfileGate profiles) {
        this.current = current;
        this.limiter = limiter;
        this.consents = consents;
        this.profiles = profiles;
    }

    public AuthenticatedUser currentUser(HttpServletRequest request) {
        return current.require(request);
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
        List<PendingConsentGate.Document> undecided = consents.undecidedFor(user.id());
        if (!undecided.isEmpty()) {
            throw new ApiException(403, "consent_required").with("pending_consents", undecided);
        }
        if (request != null) {
            request.setAttribute(CONSENTED_ATTRIBUTE, user);
        }
        return user;
    }

    public AuthenticatedUser gatedUser(HttpServletRequest request) {
        if (request != null
                && request.getAttribute(GATED_ATTRIBUTE) instanceof AuthenticatedUser user) {
            return user;
        }
        AuthenticatedUser user = consentedUser(request);
        if (!profiles.completeFor(user.id())) {
            throw new ApiException(403, "profile_required");
        }
        if (request != null) {
            request.setAttribute(GATED_ATTRIBUTE, user);
        }
        return user;
    }
}
