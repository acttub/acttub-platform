package com.acttub.actingapi.feature.push.adapter.expo;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.io.IOException;
import java.net.http.HttpResponse;
import java.util.List;
import java.util.Map;

import com.acttub.actingapi.feature.push.app.PushMessage;
import com.acttub.actingapi.platform.observability.FailureKind;
import com.acttub.actingapi.support.RecordingFailureReporter;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

class ExpoPushSenderTest {

    private static final List<PushMessage> MESSAGE = List.of(new PushMessage(
            "ExponentPushToken[test]", "완료", "분석 완료", Map.of()));

    @Test
    void transportFailureIsReportedAsExternalAndRemainsBestEffort() {
        IOException failure = new IOException("expo unavailable");
        RecordingFailureReporter reporter = new RecordingFailureReporter();
        ExpoPushSender sender = new ExpoPushSender(
                new ObjectMapper(),
                "https://exp.host/--/api/v2/push/send",
                reporter,
                request -> { throw failure; });

        sender.send(MESSAGE);

        assertThat(reporter.reports()).singleElement().satisfies(report -> {
            assertThat(report.failure()).isSameAs(failure);
            assertThat(report.kind()).isEqualTo(FailureKind.EXTERNAL);
            assertThat(report.context()).isEqualTo("ExpoPushSender.send");
        });
    }

    @Test
    void nonSuccessResponseIsReportedWithoutPuttingItsBodyInTheFailure() {
        @SuppressWarnings("unchecked")
        HttpResponse<String> response = mock(HttpResponse.class);
        when(response.statusCode()).thenReturn(503);
        when(response.body()).thenReturn("upstream response body");
        RecordingFailureReporter reporter = new RecordingFailureReporter();
        ExpoPushSender sender = new ExpoPushSender(
                new ObjectMapper(),
                "https://exp.host/--/api/v2/push/send",
                reporter,
                request -> response);

        sender.send(MESSAGE);

        assertThat(reporter.reports()).singleElement().satisfies(report -> {
            assertThat(report.failure().getMessage())
                    .isEqualTo("expo push rejected with HTTP 503")
                    .doesNotContain("upstream response body");
            assertThat(report.kind()).isEqualTo(FailureKind.EXTERNAL);
            assertThat(report.context()).isEqualTo("ExpoPushSender.send");
        });
    }

    @Test
    void interruptionRestoresTheSignalWithoutReporting() {
        RecordingFailureReporter reporter = new RecordingFailureReporter();
        ExpoPushSender sender = new ExpoPushSender(
                new ObjectMapper(),
                "https://exp.host/--/api/v2/push/send",
                reporter,
                request -> { throw new InterruptedException("shutdown"); });

        try {
            sender.send(MESSAGE);

            assertThat(Thread.currentThread().isInterrupted()).isTrue();
            assertThat(reporter.reports()).isEmpty();
        } finally {
            Thread.interrupted();
        }
    }
}
