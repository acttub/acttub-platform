package com.acttub.actingapi.platform.security;

import java.io.IOException;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.util.AntPathMatcher;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * 클라이언트 판 헤더({@code X-Acttub-Client}, 예: {@code app/1.0.0})가 없는 {@code /v2} 요청을
 * 426 으로 돌려보낸다 ({@code docs/requirements/00-common.md} 「클라이언트 판과 강제 업데이트」).
 *
 * <p>헤더가 없으면 1.0.0 이전 빌드다. 그 빌드들은 로그인 즉시 계정이 생기고 필수 문서만 게이트에
 * 걸리던 옛 규칙을 전제로 하므로, 서버에 옛 규칙을 남기는 대신 업데이트로 보낸다. 옛 앱은 모르는
 * 상태 코드에 실린 {@code detail} 문장을 그대로 보여 주므로 <b>여기만 {@code detail} 이 코드가
 * 아니라 안내 문장이다.</b> 새 앱은 문장이 아니라 상태 코드 426 을 보고 안내 화면을 띄운다.
 *
 * <p><b>다른 모든 판정보다 먼저다</b> — 토큰 검증(Spring Security 체인 안의
 * {@link AccessTokenFilter})보다 앞에 선다. 옛 빌드의 만료된 토큰이 401 을 받아 로그인 화면으로
 * 돌아가면 업데이트 안내를 영영 보지 못한다.
 *
 * <p>헤더를 보지 않는 자리:
 * <ul>
 *   <li>{@code /v2} 밖 — {@code /health} 와 관리 포트는 앱이 부르는 것이 아니다.</li>
 *   <li>제공자가 부르는 연결 끊기 콜백 — 네이버·카카오는 우리 헤더를 모른다.</li>
 *   <li>{@code /v2/admin/**} — 운영 토큰으로 여는 운영 도구의 경로이고 앱 빌드와 무관하다.</li>
 * </ul>
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE + 10)
public class ClientVersionFilter extends OncePerRequestFilter {

    public static final String HEADER = "X-Acttub-Client";

    /** 1.0.0 이전 앱이 그대로 보여 주는 문장이다. 고치면 그 화면의 문구가 바뀐다. */
    static final String UPGRADE_NOTICE = "새 버전이 나왔어요. 스토어에서 업데이트해 주세요.";

    private static final AntPathMatcher PATHS = new AntPathMatcher();

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        String path = request.getRequestURI();
        return !path.startsWith("/v2/")
                || path.startsWith("/v2/admin/")
                || PATHS.match("/v2/auth/providers/*/disconnect", path);
    }

    @Override
    protected void doFilterInternal(
            HttpServletRequest request,
            HttpServletResponse response,
            FilterChain chain)
            throws ServletException, IOException {
        String client = request.getHeader(HEADER);
        if (client == null || client.isBlank()) {
            response.setStatus(426);
            response.setContentType("application/json");
            response.setCharacterEncoding("UTF-8");
            response.getWriter().write("{\"detail\":\"" + UPGRADE_NOTICE + "\"}");
            return;
        }
        chain.doFilter(request, response);
    }
}
