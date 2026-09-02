package com.acttub.actingapi.platform.web;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;

import com.acttub.actingapi.platform.observability.FailureKind;
import com.acttub.actingapi.support.RecordingFailureReporter;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

class ApiErrorAdviceTest {

    private static final ObjectMapper JSON = new ObjectMapper();

    @Test
    void unhandledRuntimeExceptionUsesTheErrorContractAndIsReportedOnce() throws Exception {
        RecordingFailureReporter reporter = new RecordingFailureReporter();
        MockMvc mvc = MockMvcBuilders.standaloneSetup(new FailureController())
                .setControllerAdvice(new ApiErrorAdvice(JSON, reporter))
                .build();

        MvcResult result = mvc.perform(get("/test/unhandled")).andReturn();

        assertThat(result.getResponse().getStatus()).isEqualTo(500);
        assertThat(JSON.readTree(result.getResponse().getContentAsString()))
                .isEqualTo(JSON.readTree("{\"detail\":\"internal_server_error\"}"));
        assertThat(reporter.reports()).singleElement().satisfies(report -> {
            assertThat(report.failure()).isInstanceOf(RuntimeException.class);
            assertThat(report.kind()).isEqualTo(FailureKind.UNEXPECTED);
            assertThat(report.context()).isEqualTo("ApiErrorAdvice.unexpected");
        });
    }

    @Test
    void apiExceptionIsNotReported() throws Exception {
        RecordingFailureReporter reporter = new RecordingFailureReporter();
        MockMvc mvc = MockMvcBuilders.standaloneSetup(new FailureController())
                .setControllerAdvice(new ApiErrorAdvice(JSON, reporter))
                .build();

        MvcResult result = mvc.perform(get("/test/expected")).andReturn();

        assertThat(result.getResponse().getStatus()).isEqualTo(404);
        assertThat(JSON.readTree(result.getResponse().getContentAsString()))
                .isEqualTo(JSON.readTree("{\"detail\":\"not_found\"}"));
        assertThat(reporter.reports()).isEmpty();
    }

    @RestController
    private static class FailureController {

        @GetMapping("/test/unhandled")
        void unhandled() {
            throw new RuntimeException("boom");
        }

        @GetMapping("/test/expected")
        void expected() {
            throw new ApiException(404, "not_found");
        }
    }
}
