package com.acttub.actingapi.platform.harness;

import java.io.IOException;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletRequestWrapper;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.context.annotation.Profile;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/** contract 하네스가 IP rate-limit 공간을 가르기 위한 요청 origin 경계. */
@Component
@Profile("contract")
@Order(Ordered.HIGHEST_PRECEDENCE)
public class ContractClientHostFilter extends OncePerRequestFilter {
    public static final String HEADER = "X-Contract-Client-Host";

    @Override
    protected void doFilterInternal(
            HttpServletRequest request,
            HttpServletResponse response,
            FilterChain chain) throws ServletException, IOException {
        String host = request.getHeader(HEADER);
        // 제어 표면의 loopback 제한은 실제 transport 주소만 본다.
        if (host == null || host.isBlank() || request.getRequestURI().startsWith("/__harness/")) {
            chain.doFilter(request, response);
            return;
        }
        String clientHost = host.strip();
        chain.doFilter(new HttpServletRequestWrapper(request) {
            @Override
            public String getRemoteAddr() {
                return clientHost;
            }

            @Override
            public String getRemoteHost() {
                return clientHost;
            }
        }, response);
    }
}
