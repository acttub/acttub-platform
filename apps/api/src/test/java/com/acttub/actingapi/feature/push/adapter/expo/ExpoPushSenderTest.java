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
    @org.junit.jupiter.api.DisplayName("account.notification: Expo 의 ticket 은 보낸 순서대로 오고, DeviceNotRegistered 로 답한 토큰만 돌려준다")
    void ticketsThatSayDeviceNotRegisteredNameTheirTokens() {
        @SuppressWarnings("unchecked")
        HttpResponse<String> response = mock(HttpResponse.class);
        when(response.statusCode()).thenReturn(200);
        when(response.body()).thenReturn("""
                {"data":[
                  {"status":"ok","id":"ticket-1"},
                  {"status":"error","message":"the token is not a registered push notification recipient",
                   "details":{"error":"DeviceNotRegistered"}},
                  {"status":"error","message":"too big","details":{"error":"MessageTooBig"}}
                ]}
                """);
        RecordingFailureReporter reporter = new RecordingFailureReporter();
        ExpoPushSender sender = new ExpoPushSender(
                new ObjectMapper(), "https://exp.host/--/api/v2/push/send", reporter, request -> response);

        List<String> unregistered = sender.send(List.of(
                new PushMessage("ExponentPushToken[alive]", "완료", "분석 완료", Map.of()),
                new PushMessage("ExponentPushToken[gone]", "완료", "분석 완료", Map.of()),
                new PushMessage("ExponentPushToken[big]", "완료", "분석 완료", Map.of())));

        assertThat(unregistered).containsExactly("ExponentPushToken[gone]");
        assertThat(reporter.reports()).as("지울 기기는 보고하지 않고, 그 밖의 ticket 오류만 종류로 보고한다")
                .singleElement().satisfies(report -> {
                    assertThat(report.context()).isEqualTo("ExpoPushSender.tickets");
                    assertThat(report.failure().getMessage())
                            .contains("MessageTooBig").doesNotContain("DeviceNotRegistered", "ExponentPushToken");
                });
    }

    @Test
    @org.junit.jupiter.api.DisplayName("account.notification: Expo 가 읽을 수 없는 답을 주면 보고하고, 지울 기기는 없는 것으로 본다 — 본문은 보고에 싣지 않는다")
    void anUnreadableTicketResponseIsReportedAsExternal() {
        @SuppressWarnings("unchecked")
        HttpResponse<String> response = mock(HttpResponse.class);
        when(response.statusCode()).thenReturn(200);
        when(response.body()).thenReturn("<html>upstream response body</html>");
        RecordingFailureReporter reporter = new RecordingFailureReporter();
        ExpoPushSender sender = new ExpoPushSender(
                new ObjectMapper(),
                "https://exp.host/--/api/v2/push/send",
                reporter,
                request -> response);

        assertThat(sender.send(MESSAGE)).isEmpty();

        assertThat(reporter.reports()).singleElement().satisfies(report -> {
            assertThat(report.kind()).isEqualTo(FailureKind.EXTERNAL);
            assertThat(report.context()).isEqualTo("ExpoPushSender.tickets");
            assertThat(report.failure().getMessage()).doesNotContain("upstream response body");
        });
    }

    @Test
    @org.junit.jupiter.api.DisplayName("account.notification: ticket 이 DeviceNotRegistered 가 아닌 오류로 답하면 그 종류를 보고한다 — 그 토큰은 지우지 않는다")
    void ticketErrorsOtherThanDeviceNotRegisteredAreReported() {
        @SuppressWarnings("unchecked")
        HttpResponse<String> response = mock(HttpResponse.class);
        when(response.statusCode()).thenReturn(200);
        when(response.body()).thenReturn("""
                {"data":[{"status":"error","message":"too big","details":{"error":"MessageTooBig"}}]}
                """);
        RecordingFailureReporter reporter = new RecordingFailureReporter();
        ExpoPushSender sender = new ExpoPushSender(
                new ObjectMapper(),
                "https://exp.host/--/api/v2/push/send",
                reporter,
                request -> response);

        assertThat(sender.send(MESSAGE)).isEmpty();

        assertThat(reporter.reports()).singleElement().satisfies(report -> {
            assertThat(report.kind()).isEqualTo(FailureKind.EXTERNAL);
            assertThat(report.context()).isEqualTo("ExpoPushSender.tickets");
            assertThat(report.failure().getMessage()).contains("MessageTooBig");
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
