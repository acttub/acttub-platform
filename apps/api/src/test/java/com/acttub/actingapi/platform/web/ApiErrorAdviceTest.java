package com.acttub.actingapi.platform.web;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Optional;

import com.acttub.actingapi.platform.observability.FailureKind;
import com.acttub.actingapi.platform.observability.SentryFailureReporter;
import com.acttub.actingapi.support.RecordingFailureReporter;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.sentry.IScopes;
import io.sentry.ScopeCallback;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.context.request.async.AsyncRequestTimeoutException;

class ApiErrorAdviceTest {

    private static final ObjectMapper JSON = new ObjectMapper();
    private final RecordingFailureReporter reporter = new RecordingFailureReporter();
    private final MockMvc mvc = MockMvcBuilders.standaloneSetup(new FailureController())
            .setControllerAdvice(new ApiErrorAdvice(JSON, reporter))
            .build();

    @Test
    void unhandledRuntimeExceptionUsesTheErrorContractAndIsReportedOnce() throws Exception {
        MvcResult result = mvc.perform(get("/test/unhandled")).andReturn();

        assertThat(result.getResponse().getStatus()).isEqualTo(500);
        assertThat(JSON.readTree(result.getResponse().getContentAsString()))
                .isEqualTo(JSON.readTree("{\"detail\":\"internal_server_error\"}"));
        assertThat(reporter.reports()).singleElement().satisfies(report -> {
            assertThat(report.failure()).isInstanceOf(RuntimeException.class);
            assertThat(report.kind()).isEqualTo(FailureKind.UNEXPECTED);
            assertThat(report.context()).isEqualTo("ApiErrorAdvice.catchAll");
        });
    }

    @Test
    void apiExceptionIsNotReported() throws Exception {
        MvcResult result = mvc.perform(get("/test/expected")).andReturn();

        assertThat(result.getResponse().getStatus()).isEqualTo(404);
        assertThat(JSON.readTree(result.getResponse().getContentAsString()))
                .isEqualTo(JSON.readTree("{\"detail\":\"not_found\"}"));
        assertThat(reporter.reports()).isEmpty();
    }

    @Test
    void externalApiExceptionKeepsItsResponseAndReportsTheOriginalCause() throws Exception {
        MvcResult result = mvc.perform(get("/test/external")).andReturn();

        assertThat(result.getResponse().getStatus()).isEqualTo(502);
        assertThat(JSON.readTree(result.getResponse().getContentAsString()))
                .isEqualTo(JSON.readTree("{\"detail\":\"upstream_failed\"}"));
        assertThat(reporter.reports()).singleElement().satisfies(report -> {
            assertThat(report.failure())
                    .isInstanceOf(IllegalStateException.class)
                    .hasMessage("upstream boom");
            assertThat(report.kind()).isEqualTo(FailureKind.EXTERNAL);
            assertThat(report.context()).isEqualTo("ApiErrorAdvice.apiException");
        });
    }

    @Test
    void fourxxApiExceptionPreservesItsCause() {
        var cause = new IllegalArgumentException("invalid value");

        var exception = new ApiException(400, "invalid", cause);

        assertThat(exception.getCause()).isSameAs(cause);
    }

    @Test
    void generalConstructorRejectsServerErrors() {
        assertThatThrownBy(() -> new ApiException(500, "x"))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void serverFailureFactoriesRequireA5xxStatusAndCause() {
        var cause = new IllegalStateException("boom");

        assertThatThrownBy(() -> ApiException.external(499, "x", cause))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> ApiException.unexpected(600, "x", cause))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> ApiException.external(500, "x", null))
                .isInstanceOf(NullPointerException.class);
    }

    @Test
    void unsupportedContentTypeKeepsTheSpringClientErrorAndIsNotReported() throws Exception {
        MvcResult result = mvc.perform(post("/test/json")
                        .contentType(MediaType.TEXT_PLAIN)
                        .content("{}"))
                .andReturn();

        assertThat(result.getResponse().getStatus()).isEqualTo(415);
        assertThat(JSON.readTree(result.getResponse().getContentAsString()))
                .isEqualTo(JSON.readTree("{\"detail\":\"Unsupported Media Type\"}"));
        assertThat(reporter.reports()).isEmpty();
    }

    @Test
    void missingRequiredRequestParameterKeepsTheSpringClientErrorAndIsNotReported()
            throws Exception {
        MvcResult result = mvc.perform(get("/test/required-param")).andReturn();

        assertThat(result.getResponse().getStatus()).isEqualTo(400);
        assertThat(JSON.readTree(result.getResponse().getContentAsString()))
                .isEqualTo(JSON.readTree("{\"detail\":\"Bad Request\"}"));
        assertThat(reporter.reports()).isEmpty();
    }

    @Test
    void springServerErrorKeepsItsStatusAndIsReported() throws Exception {
        MvcResult result = mvc.perform(get("/test/spring-timeout")).andReturn();

        assertThat(result.getResponse().getStatus()).isEqualTo(503);
        assertThat(JSON.readTree(result.getResponse().getContentAsString()))
                .isEqualTo(JSON.readTree("{\"detail\":\"internal_server_error\"}"));
        assertThat(reporter.reports()).singleElement().satisfies(report -> {
            assertThat(report.failure()).isInstanceOf(AsyncRequestTimeoutException.class);
            assertThat(report.kind()).isEqualTo(FailureKind.UNEXPECTED);
        });
    }

    @Test
    void repeatedUnhandledFailuresOnTheAdvicePathUseTheSentrySuppressionWindow()
            throws Exception {
        IScopes scopes = mock(IScopes.class);
        var sentryReporter = new SentryFailureReporter(
                Optional.of(scopes),
                Clock.fixed(Instant.parse("2026-09-03T00:00:00Z"), ZoneOffset.UTC));
        MockMvc sentryMvc = MockMvcBuilders.standaloneSetup(new FailureController())
                .setControllerAdvice(new ApiErrorAdvice(JSON, sentryReporter))
                .build();

        sentryMvc.perform(get("/test/unhandled")).andReturn();
        sentryMvc.perform(get("/test/unhandled")).andReturn();

        verify(scopes, times(1)).captureException(any(RuntimeException.class), any(ScopeCallback.class));
    }

    @RestController
    private static class FailureController {

        @GetMapping("/test/unhandled")
        void unhandled() {
            throw new RuntimeException("boom");
        }

        @GetMapping("/test/expected")
        void expected() {
            throw new ApiException(404, "not_found", new IllegalArgumentException("missing"));
        }

        @GetMapping("/test/external")
        void external() {
            throw ApiException.external(
                    502, "upstream_failed", new IllegalStateException("upstream boom"));
        }

        @PostMapping(value = "/test/json", consumes = MediaType.APPLICATION_JSON_VALUE)
        void json() {
        }

        @GetMapping("/test/required-param")
        void requiredParam(@RequestParam String value) {
        }

        @GetMapping("/test/spring-timeout")
        void springTimeout() {
            throw new AsyncRequestTimeoutException();
        }
    }
}
