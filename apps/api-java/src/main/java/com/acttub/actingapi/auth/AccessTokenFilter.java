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
        // 인증 의존성이 **아예 없는** 경로 — 원본은 Authorization 헤더를 읽지도 않는다
        // (`consents.py:build_router.list_documents`, `admissions.py:build_router`).
        // 이 필터는 "헤더가 있으면 검증"이라 만료 토큰을 전역으로 붙이는 클라이언트가
        // 약관·입시 정보 같은 온보딩 콘텐츠에서 401 을 받게 된다. 커뮤니티 읽기는 다르다 —
        // `auth/dependencies.py:build_optional_user_dependency` 가 토큰이 있으면 검증하고
        // 실패 시 401 을 내므로 지금 동작이 맞다.
        if (path.equals("/v2/consents/documents") || path.startsWith("/v2/admissions")) {
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
