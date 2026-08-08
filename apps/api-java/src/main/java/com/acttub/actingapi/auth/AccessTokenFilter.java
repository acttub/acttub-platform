package com.acttub.actingapi.auth;

import java.io.IOException;

import com.acttub.actingapi.web.ApiException;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/** Bearer 진입점에서 Spring ProblemDetail 대신 기존 detail 문자열을 직접 보장한다. */
@Component
public class AccessTokenFilter extends OncePerRequestFilter {

    private final CurrentUserService users;

    public AccessTokenFilter(CurrentUserService users) {
        this.users = users;
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        String path = request.getRequestURI();
        if (path.equals("/health")
                || path.equals("/v2/auth/login")
                || path.equals("/v2/auth/refresh")
                || path.startsWith("/v3/api-docs")) {
            return true;
        }
        // /v2/admin/* 은 사용자 토큰이 아니라 ADMIN_OPS_TOKEN 을 Authorization 으로 받는다
        // (admin.py:build_router.require_token). 여기서 걸러내지 않으면 관리자 토큰을 액세스
        // 토큰으로 검증하려다 401 invalid or missing access token 이 나가, 원본이 내는
        // 401 Unauthorized 와 달라진다.
        if (path.startsWith("/v2/admin/")) {
            return true;
        }
        return request.getHeader("Authorization") == null && !path.equals("/v2/auth/logout");
    }

    @Override
    protected void doFilterInternal(
            HttpServletRequest request,
            HttpServletResponse response,
            FilterChain chain)
            throws ServletException, IOException {
        try {
            users.require(request);
            chain.doFilter(request, response);
        } catch (ApiException e) {
            response.setStatus(e.status());
            response.setContentType("application/json");
            response.setCharacterEncoding("UTF-8");
            response.getWriter().write("{\"detail\":\"" + e.getMessage() + "\"}");
        }
    }
}
