package com.acttub.actingapi.platform.web;

import java.io.ByteArrayInputStream; import java.io.IOException; import java.io.InputStreamReader;
import java.io.BufferedReader; import java.nio.charset.StandardCharsets;
import jakarta.servlet.*; import jakarta.servlet.http.*;
import org.springframework.core.Ordered; import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component; import org.springframework.util.StreamUtils;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * 오류 응답의 `input` 필드는 원래 요청 값을 그대로 되돌려줘야 한다(FastAPI 계약).
 * 그래서 바디를 advice 가 다시 읽을 수 있어야 하는데, Spring 의 ContentCachingRequestWrapper 는
 * **lazy** 라 소비된 만큼만 캐시한다 — Jackson 이 첫 필드에서 타입 오류로 멈추면 뒤쪽 바디가
 * 캐시에 없어 재파싱이 깨지고 `input` 이 null 로 나간다. 여기서는 전량을 미리 읽어 둔다.
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
public class RequestBodyCachingFilter extends OncePerRequestFilter {

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        chain.doFilter(new CachedBodyRequest(request), response);
    }

    /** 생성 시점에 바디 전체를 읽어 두고, 그 사본을 몇 번이든 다시 내준다. */
    static final class CachedBodyRequest extends HttpServletRequestWrapper {
        private final byte[] body;

        CachedBodyRequest(HttpServletRequest request) throws IOException {
            super(request);
            this.body = StreamUtils.copyToByteArray(request.getInputStream());
        }

        byte[] body() {
            return body;
        }

        @Override
        public ServletInputStream getInputStream() {
            ByteArrayInputStream source = new ByteArrayInputStream(body);
            return new ServletInputStream() {
                @Override public int read() { return source.read(); }
                @Override public boolean isFinished() { return source.available() == 0; }
                @Override public boolean isReady() { return true; }
                @Override public void setReadListener(ReadListener listener) { }
            };
        }

        @Override
        public BufferedReader getReader() {
            return new BufferedReader(new InputStreamReader(getInputStream(), StandardCharsets.UTF_8));
        }
    }
}
