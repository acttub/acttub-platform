package com.acttub.actingapi.security;

import java.util.List;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.HttpMethod;
import org.springframework.stereotype.Component;
import org.springframework.util.AntPathMatcher;
import org.springframework.web.method.HandlerMethod;
import org.springframework.web.servlet.HandlerInterceptor;

/** FastAPI에서 consented_user dependency를 쓰는 라우트를 인자 해석 전에 막는다. */
@Component
public final class ConsentGateInterceptor implements HandlerInterceptor {
    private static final AntPathMatcher PATHS = new AntPathMatcher();

    // acting_api/app.py가 consented_user를 주입하는 라우트의 명시적 표다. 읽기 전용
    // community 라우트와 practice-session DELETE는 의도적으로 포함하지 않는다.
    private static final List<ConsentRoute> CONSENTED_ROUTES = List.of(
            route(HttpMethod.POST, "/v2/community/posts"),
            route(HttpMethod.PATCH, "/v2/community/posts/*"),
            route(HttpMethod.DELETE, "/v2/community/posts/*"),
            route(HttpMethod.POST, "/v2/community/posts/*/likes"),
            route(HttpMethod.DELETE, "/v2/community/posts/*/likes"),
            route(HttpMethod.POST, "/v2/community/posts/*/comments"),
            route(HttpMethod.PATCH, "/v2/community/comments/*"),
            route(HttpMethod.DELETE, "/v2/community/comments/*"),
            route(HttpMethod.POST, "/v2/community/reports"),
            route(HttpMethod.GET, "/v2/community/blocks"),
            route(HttpMethod.POST, "/v2/community/blocks"),
            route(HttpMethod.DELETE, "/v2/community/blocks/*"),
            route(HttpMethod.POST, "/v2/uploads/intents"),
            route(HttpMethod.POST, "/v2/uploads/intents/*/complete"),
            route(HttpMethod.POST, "/v2/practice-sessions"),
            route(HttpMethod.GET, "/v2/practice-sessions"),
            route(HttpMethod.GET, "/v2/practice-sessions/*"),
            route(HttpMethod.GET, "/v2/practice-sessions/*/status"),
            route(HttpMethod.POST, "/v2/practice-sessions/*/analyze"),
            route(HttpMethod.POST, "/v2/coach/start"),
            route(HttpMethod.POST, "/v2/coach/reply"),
            route(HttpMethod.POST, "/v2/coach/confirm"),
            route(HttpMethod.POST, "/v2/reports"),
            route(HttpMethod.GET, "/v2/reports"),
            route(HttpMethod.GET, "/v2/reports/*"));

    private final AccessGate auth;

    public ConsentGateInterceptor(AccessGate auth) {
        this.auth = auth;
    }

    @Override
    public boolean preHandle(
            HttpServletRequest request,
            HttpServletResponse response,
            Object handler) {
        if (handler instanceof HandlerMethod
                && requiresConsent(request.getMethod(), normalizedPath(request.getRequestURI()))) {
            auth.consentedUser(request);
        }
        return true;
    }

    static boolean requiresConsent(String method, String path) {
        return CONSENTED_ROUTES.stream().anyMatch(route -> route.matches(method, path));
    }

    private static String normalizedPath(String path) {
        if (path.length() > 1 && path.endsWith("/")) {
            return path.substring(0, path.length() - 1);
        }
        return path;
    }

    private static ConsentRoute route(HttpMethod method, String pattern) {
        return new ConsentRoute(method.name(), pattern);
    }

    private record ConsentRoute(String method, String pattern) {
        boolean matches(String actualMethod, String path) {
            return method.equals(actualMethod) && PATHS.match(pattern, path);
        }
    }
}
