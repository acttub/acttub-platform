package com.acttub.actingapi.platform.observability;

import java.io.IOException;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.security.autoconfigure.web.servlet.SecurityFilterProperties;
import org.springframework.core.annotation.Order;
import org.springframework.http.server.RequestPath;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;
import org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping;
import org.springframework.web.util.ServletRequestPathUtils;

/**
 * 보안 필터가 막은 요청에도 경로 템플릿을 붙인다.
 *
 * <p>Spring Security 6 은 보안 필터 앞에서 MVC 핸들러를 미리 찾았고(HandlerMappingIntrospector), 그 부작용으로
 * 토큰이 틀려 {@code AccessTokenFilter} 가 401 로 끝낸 요청도 {@code http_server_requests} 의 {@code uri} 와 요청
 * 로그의 {@code route} 에 경로 템플릿이 붙었다. Spring Framework 7.1 에서 그 장치가 없어져 이런 요청이
 * {@code uri="UNKNOWN"}·{@code route} 없음으로 바뀌었다. 대시보드가 {@code uri} 로 요청을 가르므로 같은 자리
 * (보안 필터 바로 앞)에서 핸들러를 찾아 예전과 같게 둔다. 핸들러를 고르지 못한 요청(404·405)에는 아무것도 붙지
 * 않는다 — 예전에도 {@code NOT_FOUND}·{@code UNKNOWN} 이었다. 실제 디스패치는 같은 값을 다시 정한다.
 */
@Component
@Order(SecurityFilterProperties.DEFAULT_FILTER_ORDER - 1)
class RoutePatternFilter extends OncePerRequestFilter {

    private final ObjectProvider<RequestMappingHandlerMapping> mapping;

    RoutePatternFilter(@Qualifier("requestMappingHandlerMapping") ObjectProvider<RequestMappingHandlerMapping> mapping) {
        this.mapping = mapping;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        RequestMappingHandlerMapping handlers = mapping.getIfAvailable();
        if (handlers != null) {
            RequestPath previous = (RequestPath) request.getAttribute(ServletRequestPathUtils.PATH_ATTRIBUTE);
            try {
                ServletRequestPathUtils.parseAndCache(request);
                handlers.getHandler(request);
            } catch (Exception noHandler) {
                // 메서드·미디어 타입이 맞지 않는 등 핸들러를 고르지 못했다. 여기서 응답을 정하지 않는다 — 이 조회는 라벨만
                // 위한 것이고, DispatcherServlet 이 같은 조회를 다시 해서 같은 예외를 ApiErrorAdvice 로 응답한다.
            } finally {
                ServletRequestPathUtils.setParsedRequestPath(previous, request);
            }
        }
        chain.doFilter(request, response);
    }
}
