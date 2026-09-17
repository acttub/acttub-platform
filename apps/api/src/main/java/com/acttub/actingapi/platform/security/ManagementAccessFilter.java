package com.acttub.actingapi.platform.security;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Collections;
import java.util.Set;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.web.servlet.context.ServletWebServerApplicationContext;
import org.springframework.context.ApplicationContext;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/** The monitoring credential is valid only on the separate management listener. */
@Component
public class ManagementAccessFilter extends OncePerRequestFilter {
    private static final Set<String> PATHS = Set.of("/actuator/prometheus", "/actuator/health/db");
    private final ApplicationContext application;
    private final byte[] authorization;

    public ManagementAccessFilter(ApplicationContext application, @Value("${MONITORING_TOKEN:}") String token) {
        this.application = application;
        this.authorization = token.isBlank() ? null : ("Bearer " + token).getBytes(StandardCharsets.UTF_8);
    }

    boolean matches(HttpServletRequest request) {
        // ForwardedHeaderFilter may prepend X-Forwarded-Prefix to getRequestURI(), but not the servlet path.
        String path = request.getServletPath();
        return isManagementPort(request) || path.equals("/actuator") || path.startsWith("/actuator/");
    }

    private boolean isManagementPort(HttpServletRequest request) {
        // getServerPort()/Host can be rewritten by forwarded headers. The connector's local port cannot.
        return application instanceof ServletWebServerApplicationContext web && web.getWebServer() != null
                && request.getLocalPort() != web.getWebServer().getPort()
                && request.getServletContext() != web.getServletContext();
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        if (!isManagementPort(request) || !PATHS.contains(request.getServletPath())
                || !request.getMethod().equals("GET")) {
            response.setStatus(HttpServletResponse.SC_NOT_FOUND);
            return;
        }
        var headers = Collections.list(request.getHeaders("Authorization"));
        if (authorization == null || headers.size() != 1 || !MessageDigest.isEqual(
                authorization, headers.getFirst().getBytes(StandardCharsets.UTF_8))) {
            response.setHeader("WWW-Authenticate", "Bearer");
            response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
            return;
        }
        chain.doFilter(request, response);
    }
}
