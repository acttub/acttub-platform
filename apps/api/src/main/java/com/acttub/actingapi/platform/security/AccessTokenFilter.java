package com.acttub.actingapi.platform.security;

import java.io.IOException;

import com.acttub.actingapi.platform.web.ApiException;
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
                || path.equals("/v2/auth/signup")
                // 게스트 만들기는 끝난 게스트의 토큰을 아직 붙이고 있는 웹이 부른다.
                || path.equals("/v2/auth/guest")
                || path.startsWith("/v3/api-docs")) {
            return true;
        }
        // 켜져 있는 제공자 목록은 로그인 전에 부르는 공개 경로이고, 그 아래의 연결 끊기 알림은 제공자가
        // 부른다. 카카오는 `Authorization: KakaoAK <어드민 키>` 를 싣는데, 그것을 액세스 토큰으로
        // 검증하려 들면 알림이 전부 401 이 된다.
        if (path.equals("/v2/auth/providers") || path.startsWith("/v2/auth/providers/")) {
            return true;
        }
        // 인증 의존성이 **아예 없는** 경로 — 원본은 Authorization 헤더를 읽지도 않는다
        // (`consents.py:build_router.list_documents`, `admissions.py:build_router`).
        // 이 필터는 "헤더가 있으면 검증"이라 만료 토큰을 전역으로 붙이는 클라이언트가
        // 약관·입시 정보 같은 온보딩 콘텐츠에서 401 을 받게 된다.
        if (path.equals("/v2/consents/documents")
                || path.equals("/v2/consents/notices")
                || path.startsWith("/v2/admissions")) {
            return true;
        }
        // /v2/admin/* 은 사용자 토큰이 아니라 ADMIN_OPS_TOKEN 을 Authorization 으로 받는다
        // (admin.py:build_router.require_token). 여기서 걸러내지 않으면 관리자 토큰을 액세스
        // 토큰으로 검증하려다 401 invalid or missing access token 이 나가, 원본이 내는
        // 401 Unauthorized 와 달라진다.
        if (path.startsWith("/v2/admin/")) {
            return true;
        }
        // 푸시 토큰 삭제는 로그인 없이 받는다(account.notification). 로그아웃하는 앱이 막 만료된 액세스 토큰을
        // 붙여 보내도 401 로 막히면 안 된다 — 그 삭제가 실패하면 옛 계정의 알림이 그 폰에 계속 온다.
        if (path.equals("/v2/push-tokens") && "DELETE".equalsIgnoreCase(request.getMethod())) {
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
