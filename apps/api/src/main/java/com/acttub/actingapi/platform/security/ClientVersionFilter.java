package com.acttub.actingapi.platform.security;

import java.io.IOException;
import java.math.BigInteger;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.util.AntPathMatcher;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * 클라이언트 판 헤더({@code X-Acttub-Client}, 예: {@code app/0.1.0})가 없는 {@code /v2} 요청을
 * 426 으로 돌려보낸다 ({@code docs/specs/common.md} 「클라이언트 판과 강제 업데이트」).
 *
 * <p>헤더가 없으면 0.1.0 이전 빌드다. 그 빌드들은 로그인 즉시 계정이 생기고 필수 문서만 게이트에
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
 *
 * <p><b>플랫폼별 최소 판</b>(SOMA-1049) — {@code MIN_APP_VERSION_IOS}·{@code MIN_APP_VERSION_ANDROID} 보다 낮은 앱도
 * 같은 426으로 업데이트 화면에 보낸다. 판 헤더에는 플랫폼이 없어 User-Agent 로 가른다(iOS 는
 * {@code Acttub/61 CFNetwork/… Darwin/…}, 안드로이드는 {@code okhttp/…} — 11/5 운영 refresh_tokens 로 확인).
 * 값이 비었거나, 플랫폼·판을 모르면 막지 않는다. <b>스토어에 그 판이 공개된 뒤에만 켠다</b> — 먼저 켜면 받을 판이 없는
 * 사용자가 업데이트 화면에 갇힌다.
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE + 10)
public class ClientVersionFilter extends OncePerRequestFilter {

    public static final String HEADER = "X-Acttub-Client";

    /** 0.1.0 이전 앱이 그대로 보여 주는 문장이다. 고치면 그 화면의 문구가 바뀐다. */
    static final String UPGRADE_NOTICE = "새 버전이 나왔어요. 스토어에서 업데이트해 주세요.";

    private static final AntPathMatcher PATHS = new AntPathMatcher();

    private final String minimumIos;
    private final String minimumAndroid;

    /** 최소 판 없이 — 헤더 없는 요청만 막는다. */
    public ClientVersionFilter() {
        this("", "");
    }

    @Autowired
    public ClientVersionFilter(
            @Value("${MIN_APP_VERSION_IOS:}") String minimumIos,
            @Value("${MIN_APP_VERSION_ANDROID:}") String minimumAndroid) {
        this.minimumIos = minimumIos == null ? "" : minimumIos.strip();
        this.minimumAndroid = minimumAndroid == null ? "" : minimumAndroid.strip();
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        String path = request.getRequestURI();
        return !path.startsWith("/v2/")
                || path.startsWith("/v2/admin/")
                // 블로그 공개 읽기(app.blog): 웹 서버 렌더와 <img> 가 부르므로 앱 헤더를 싣지 못한다.
                || path.startsWith("/v2/blog/")
                // PG 심사 전용 테스트 결제(SOMA-620): 토스가 브라우저를 되돌려 보내는 콜백은 우리 헤더를 실을 수 없다.
                // 실제 앱 계정과 무관한 별도 쿠키 세션 경로이며, 설정이 꺼져 있으면 경로 자체가 404 다.
                || path.startsWith("/v2/pg-review/")
                // 앱 Pro 카드 등록 창(SOMA-818): 앱이 브라우저로 여는 페이지와 토스 콜백이라 앱 헤더가 없다. 일회용 state 가 권한이다.
                || path.startsWith("/v2/billing/web/")
                // 스토어 서버 알림(SOMA-818 2단계): Apple·Google 서버가 부른다. 앱 헤더가 없고 서명·푸시 인증이 권한이다.
                || path.startsWith("/v2/billing/store-notify/")
                || PATHS.match("/v2/auth/providers/*/disconnect", path);
    }

    @Override
    protected void doFilterInternal(
            HttpServletRequest request,
            HttpServletResponse response,
            FilterChain chain)
            throws ServletException, IOException {
        String client = request.getHeader(HEADER);
        if (client == null || client.isBlank() || outdated(client, request.getHeader("User-Agent"))) {
            response.setStatus(426);
            response.setContentType("application/json");
            response.setCharacterEncoding("UTF-8");
            response.getWriter().write("{\"detail\":\"" + UPGRADE_NOTICE + "\"}");
            return;
        }
        chain.doFilter(request, response);
    }

    /** 이 플랫폼의 최소 판보다 낮은 앱인가. 플랫폼·판·최소 판 중 하나라도 모르면 false. */
    private boolean outdated(String client, String userAgent) {
        if (!client.startsWith("app/") || userAgent == null) return false;
        String minimum = userAgent.contains("CFNetwork") && userAgent.contains("Darwin") ? minimumIos
                : userAgent.startsWith("okhttp/") ? minimumAndroid
                : "";
        BigInteger[] actual = version(client.substring(4));
        BigInteger[] required = version(minimum);
        if (actual == null || required == null) return false;
        for (int i = 0; i < Math.max(actual.length, required.length); i++) {
            BigInteger a = i < actual.length ? actual[i] : BigInteger.ZERO;
            BigInteger b = i < required.length ? required[i] : BigInteger.ZERO;
            int compared = a.compareTo(b);
            if (compared != 0) return compared < 0;
        }
        return false;
    }

    /** 점으로 이은 숫자(1.1.2)만 판으로 읽는다. 아니면 null. */
    private static BigInteger[] version(String value) {
        if (value.isEmpty() || value.length() > 64 || !value.matches("[0-9]++(?:\\.[0-9]++)*+")) return null;
        String[] parts = value.split("\\.");
        BigInteger[] parsed = new BigInteger[parts.length];
        for (int i = 0; i < parts.length; i++) parsed[i] = new BigInteger(parts[i]);
        return parsed;
    }
}
