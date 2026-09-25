package com.acttub.actingapi.platform.security;

import java.util.List;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.HttpMethod;
import org.springframework.stereotype.Component;
import org.springframework.util.AntPathMatcher;
import org.springframework.web.method.HandlerMethod;
import org.springframework.web.servlet.HandlerInterceptor;

/**
 * 회원 게이트를 인자 해석 전에 세운다 — 막힌 요청의 본문을 검증할 이유가 없다.
 *
 * <p><b>표는 게이트 밖을 적는다.</b> 보호 기능을 하나씩 적던 종전의 표는 새 기능을 적지 않으면
 * 조용히 열려 있었다. 이제 {@code /v2} 의 모든 경로가 보호 기능이고, 밖에 있는 것만 여기 있다
 * ({@code docs/requirements/00-common.md} 「게이트와 보호 기능」): 로그인·토큰 갱신·로그아웃, 동의
 * 문서 조회와 제출, 내 계정 조회, 프로필 입력, 탈퇴. 로그인 없이 여는 공개 경로(입시 정보)와 운영
 * 토큰 경로도 회원 게이트와 무관하다.
 */
@Component
public final class ConsentGateInterceptor implements HandlerInterceptor {
    private static final AntPathMatcher PATHS = new AntPathMatcher();

    private static final List<Route> OUTSIDE_THE_GATE = List.of(
            route(null, "/v2/auth/**"),
            route(null, "/v2/consents/**"),
            route(HttpMethod.GET, "/v2/me"),
            route(HttpMethod.DELETE, "/v2/me"),
            // 푸시 토큰 삭제는 로그아웃의 첫 단계다. 동의가 미결정이어도 로그아웃은 된다.
            route(HttpMethod.DELETE, "/v2/push-tokens"),
            route(null, "/v2/admissions/**"),
            // 포트폴리오 공개 조회 — 받은 링크를 로그인 없이 여는 사람이 본다.
            route(HttpMethod.GET, "/v2/public/**"),
            route(null, "/v2/admin/**"));

    /** 게스트만 쓰는 자리. 필요한 동의 문서가 없어 게이트 밖이고, 회원이 부르면 403 {@code guest_only} 다. */
    private static final List<Route> GUEST_ONLY = List.of(
            route(null, "/v2/guest/**"));

    /** 동의까지만 본다. 프로필이 비어 있는 사람이 프로필을 채우는 자리다. */
    private static final List<Route> CONSENT_ONLY = List.of(
            route(HttpMethod.PUT, "/v2/me/profile"));

    private final AccessGate auth;

    public ConsentGateInterceptor(AccessGate auth) {
        this.auth = auth;
    }

    @Override
    public boolean preHandle(
            HttpServletRequest request,
            HttpServletResponse response,
            Object handler) {
        if (!(handler instanceof HandlerMethod)) {
            return true;
        }
        switch (gateFor(request.getMethod(), normalizedPath(request.getRequestURI()))) {
            case FULL -> auth.gatedUser(request);
            case CONSENT_ONLY -> auth.consentedUser(request);
            case GUEST_ONLY -> auth.guestUser(request);
            case NONE -> { }
        }
        return true;
    }

    static Gate gateFor(String method, String path) {
        if (!path.startsWith("/v2/") || matches(OUTSIDE_THE_GATE, method, path)) {
            return Gate.NONE;
        }
        if (matches(GUEST_ONLY, method, path)) {
            return Gate.GUEST_ONLY;
        }
        return matches(CONSENT_ONLY, method, path) ? Gate.CONSENT_ONLY : Gate.FULL;
    }

    enum Gate {
        NONE,
        GUEST_ONLY,
        CONSENT_ONLY,
        FULL
    }

    private static boolean matches(List<Route> routes, String method, String path) {
        return routes.stream().anyMatch(route -> route.matches(method, path));
    }

    private static String normalizedPath(String path) {
        if (path.length() > 1 && path.endsWith("/")) {
            return path.substring(0, path.length() - 1);
        }
        return path;
    }

    private static Route route(HttpMethod method, String pattern) {
        return new Route(method == null ? null : method.name(), pattern);
    }

    /** {@code method} 가 {@code null} 이면 모든 메서드다. */
    private record Route(String method, String pattern) {
        boolean matches(String actualMethod, String path) {
            return (method == null || method.equals(actualMethod)) && PATHS.match(pattern, path);
        }
    }
}
