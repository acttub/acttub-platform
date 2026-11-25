package com.acttub.actingapi.platform.web;

import java.io.IOException;
import java.util.UUID;
import java.util.regex.Pattern;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import com.acttub.actingapi.platform.observability.ClientLabel;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;
import org.springframework.web.servlet.HandlerMapping;

/**
 * 요청마다 로그 문맥에 {@code trace_id} 를 넣고, 끝나면 요청 한 줄을 남긴 뒤 지운다(로그 필드는 docs/deploy/DEPLOY-HOME.md 「로그」).
 *
 * <p>값은 nginx 가 만들어 {@value #HEADER} 로 넘긴다. {@code X-Request-Id} 는 쓰지 않는다 — 그 헤더는 본문의
 * {@code request_id} 와 같은지 검사하는 재전송 열쇠다({@link RequestIdHeader}). nginx 를 거치지 않은 요청(로컬·테스트)은
 * 여기서 만든다. 모양이 다른 값은 받지 않는다 — 로그 필드에 아무 글자나 실리지 않게 한다.
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
public class TraceIdFilter extends OncePerRequestFilter {
    public static final String HEADER = "X-Acttub-Trace-Id";
    public static final String TRACE_ID = "trace_id";
    public static final String USER_ID = "user_id";

    private static final Logger LOG = LoggerFactory.getLogger(TraceIdFilter.class);
    private static final Pattern NGINX_REQUEST_ID = Pattern.compile("[0-9a-f]{32}");

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        String incoming = request.getHeader(HEADER);
        MDC.put(TRACE_ID, incoming != null && NGINX_REQUEST_ID.matcher(incoming).matches()
                ? incoming
                : UUID.randomUUID().toString().replace("-", ""));
        long started = System.nanoTime();
        try {
            chain.doFilter(request, response);
        } finally {
            if (!isHealthCheck(request.getRequestURI())) {
                // 주소는 값이 든 경로 대신 매핑 패턴으로 남긴다. 컨트롤러에 닿기 전에 끝난 요청(401·404 등)은 null 이다.
                LOG.atInfo()
                        .addKeyValue("method", request.getMethod())
                        .addKeyValue("route", request.getAttribute(HandlerMapping.BEST_MATCHING_PATTERN_ATTRIBUTE))
                        .addKeyValue("status", response.getStatus())
                        .addKeyValue("took_ms", (System.nanoTime() - started) / 1_000_000)
                        // 클라이언트 버전은 정해진 꼴만 그대로 싣는다(그 밖은 other, 없으면 none). 426 으로 막힌 요청도 남는다.
                        .addKeyValue("client", ClientLabel.of(request))
                        .log("request");
            }
            MDC.remove(TRACE_ID);
            MDC.remove(USER_ID);
        }
    }

    private static boolean isHealthCheck(String path) {
        return path.equals("/health") || path.startsWith("/actuator");
    }
}
