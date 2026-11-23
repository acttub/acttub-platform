package com.acttub.actingapi.platform.web;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.LoggerContext;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.AppenderBase;
import com.acttub.actingapi.platform.schema.UserStatus;
import com.acttub.actingapi.platform.security.AuthenticatedUser;
import com.acttub.actingapi.platform.security.CurrentUserService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.FilterChain;
import jakarta.servlet.http.HttpServletRequest;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;
import org.springframework.boot.logging.logback.StructuredLogEncoder;
import org.springframework.core.env.Environment;
import org.springframework.core.env.StandardEnvironment;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.web.servlet.HandlerMapping;
import com.acttub.actingapi.platform.json.LenientJson;

/**
 * 요청 ID·사용자 ID 가 로그 문맥에 들어가고 요청 끝에 지워지는지, 서버가 쓰는 JSON 형식(compose 의
 * LOGGING_STRUCTURED_FORMAT_CONSOLE=logstash)의 요청 한 줄에 그 필드가 실리는지 본다.
 */
class TraceIdFilterTest {
    private static final String NGINX_ID = "0123456789abcdef0123456789abcdef";

    private final List<String> lines = new ArrayList<>();
    private final Logger logger = (Logger) LoggerFactory.getLogger(TraceIdFilter.class);
    private AppenderBase<ILoggingEvent> appender;

    @BeforeEach
    void captureJsonLines() {
        LoggerContext context = (LoggerContext) LoggerFactory.getILoggerFactory();
        context.putObject(Environment.class.getName(), new StandardEnvironment());
        StructuredLogEncoder encoder = new StructuredLogEncoder();
        encoder.setContext(context);
        encoder.setFormat("logstash");
        encoder.start();
        appender = new AppenderBase<>() {
            @Override
            protected void append(ILoggingEvent event) {
                // 이벤트를 받은 자리에서 바로 쓴다 — 문맥(MDC)은 필터가 끝나면 지워진다.
                lines.add(new String(encoder.encode(event), StandardCharsets.UTF_8));
            }
        };
        appender.setContext(context);
        appender.start();
        logger.addAppender(appender);
    }

    @AfterEach
    void detach() {
        logger.detachAppender(appender);
        MDC.clear();
    }

    @Test
    void keepsTheNginxIdAddsTheUserAndClearsBothAtTheEnd() throws Exception {
        UUID userId = UUID.randomUUID();
        CurrentUserService users = new CurrentUserService(
                token -> userId,
                id -> new AuthenticatedUser(id, "actor@example.com", UserStatus.ACTIVE),
                id -> false);
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/v2/scripts/42");
        request.addHeader(TraceIdFilter.HEADER, NGINX_ID);
        request.addHeader("Authorization", "Bearer token");
        List<String> seen = new ArrayList<>();
        MockHttpServletResponse response = new MockHttpServletResponse();

        new TraceIdFilter().doFilter(request, response, (req, res) -> {
            users.require((HttpServletRequest) req);
            seen.add(MDC.get("trace_id"));
            seen.add(MDC.get("user_id"));
            req.setAttribute(HandlerMapping.BEST_MATCHING_PATTERN_ATTRIBUTE, "/v2/scripts/{script_id}");
            ((MockHttpServletResponse) res).setStatus(204);
        });

        assertThat(seen).containsExactly(NGINX_ID, userId.toString());
        assertThat(MDC.get("trace_id")).isNull();
        assertThat(MDC.get("user_id")).isNull();
        assertThat(lines).hasSize(1);
        JsonNode line = new ObjectMapper().readTree(lines.get(0));
        assertThat(LenientJson.asText(line.get("message"))).isEqualTo("request");
        assertThat(LenientJson.asText(line.get("trace_id"))).isEqualTo(NGINX_ID);
        assertThat(LenientJson.asText(line.get("user_id"))).isEqualTo(userId.toString());
        assertThat(LenientJson.asText(line.get("method"))).isEqualTo("GET");
        assertThat(LenientJson.asText(line.get("route"))).isEqualTo("/v2/scripts/{script_id}");
        assertThat(LenientJson.asInt(line.get("status"))).isEqualTo(204);
        assertThat(line.has("took_ms")).isTrue();
        assertThat(lines.get(0)).doesNotContain("actor@example.com").doesNotContain("/v2/scripts/42");
    }

    @Test
    void makesItsOwnIdWhenTheHeaderIsMissingOrMalformed() throws Exception {
        List<String> seen = new ArrayList<>();
        FilterChain chain = (req, res) -> seen.add(MDC.get("trace_id"));
        MockHttpServletRequest malformed = new MockHttpServletRequest("GET", "/v2/me");
        malformed.addHeader(TraceIdFilter.HEADER, "\"},\"user_id\":\"forged");

        new TraceIdFilter().doFilter(new MockHttpServletRequest("GET", "/v2/me"), new MockHttpServletResponse(), chain);
        new TraceIdFilter().doFilter(malformed, new MockHttpServletResponse(), chain);

        assertThat(seen).hasSize(2).allMatch(id -> id.matches("[0-9a-f]{32}")).doesNotHaveDuplicates();
    }

    @Test
    void leavesTheRetransmitHeaderAloneAndSkipsHealthChecks() throws Exception {
        MockHttpServletRequest health = new MockHttpServletRequest("GET", "/health");
        health.addHeader(RequestIdHeader.NAME, UUID.randomUUID().toString());
        List<String> seen = new ArrayList<>();

        new TraceIdFilter().doFilter(health, new MockHttpServletResponse(),
                (req, res) -> seen.add(((HttpServletRequest) req).getHeader(RequestIdHeader.NAME)));

        assertThat(seen).containsExactly(health.getHeader(RequestIdHeader.NAME));
        assertThat(lines).isEmpty();
    }
}
