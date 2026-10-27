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
    void connectionFailureIsRetriedThenLoggedWithoutReport() {
        java.util.concurrent.atomic.AtomicInteger calls = new java.util.concurrent.atomic.AtomicInteger();
        RecordingFailureReporter reporter = new RecordingFailureReporter();
        ExpoPushSender sender = new ExpoPushSender(
                new ObjectMapper(),
                "https://exp.host/--/api/v2/push/send",
                reporter,
                request -> { calls.incrementAndGet(); throw new java.net.ConnectException("expo unavailable"); }) {
            @Override long backoffMillis(int attempt) { return 0; }
        };

        sender.send(MESSAGE);

        assertThat(calls.get()).isEqualTo(3);
        assertThat(reporter.reports()).isEmpty();
    }

    @Test
    void transientConnectionFailureSucceedsOnRetry() {
        java.util.concurrent.atomic.AtomicInteger calls = new java.util.concurrent.atomic.AtomicInteger();
        @SuppressWarnings("unchecked")
        HttpResponse<String> response = mock(HttpResponse.class);
        when(response.statusCode()).thenReturn(200);
        when(response.body()).thenReturn("{\"data\":[{\"status\":\"ok\",\"id\":\"t\"}]}");
        RecordingFailureReporter reporter = new RecordingFailureReporter();
        ExpoPushSender sender = new ExpoPushSender(
                new ObjectMapper(), "https://exp.host/--/api/v2/push/send", reporter,
                request -> {
                    if (calls.incrementAndGet() < 2) throw new java.net.ConnectException("flaky");
                    return response;
                }) {
            @Override long backoffMillis(int attempt) { return 0; }
        };

        sender.send(MESSAGE);

        assertThat(calls.get()).isEqualTo(2);
        assertThat(reporter.reports()).isEmpty();
    }

    @Test
    void nonIoFailureIsStillReportedAsExternal() {
        IllegalStateException failure = new IllegalStateException("boom");
        RecordingFailureReporter reporter = new RecordingFailureReporter();
        ExpoPushSender sender = new ExpoPushSender(
                new ObjectMapper(), "https://exp.host/--/api/v2/push/send", reporter,
                request -> { throw failure; });

        sender.send(MESSAGE);

        assertThat(reporter.reports()).singleElement().satisfies(report -> {
            assertThat(report.failure()).isSameAs(failure);
            assertThat(report.kind()).isEqualTo(FailureKind.EXTERNAL);
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
    @org.junit.jupiter.api.DisplayName("account.notification: Expo 는 요청 하나에 100건까지 받으므로 나눠 보내고, 모든 요청의 DeviceNotRegistered 토큰을 돌려준다")
    void moreThanOneHundredMessagesAreSentInRequestsOfAtMostOneHundred() throws Exception {
        ObjectMapper json = new ObjectMapper();
        List<Integer> requestSizes = new java.util.ArrayList<>();
        RecordingFailureReporter reporter = new RecordingFailureReporter();
        ExpoPushSender sender = new ExpoPushSender(json, "https://exp.host/--/api/v2/push/send", reporter, request -> {
            String body = new String(new BodySubscriber(request).bytes(), java.nio.charset.StandardCharsets.UTF_8);
            int size = json.readTree(body).size();
            requestSizes.add(size);
            @SuppressWarnings("unchecked")
            HttpResponse<String> response = mock(HttpResponse.class);
            if (size > 100) {
                when(response.statusCode()).thenReturn(400);
                return response;
            }
            when(response.statusCode()).thenReturn(200);
            // 각 요청의 마지막 기기만 등록되지 않은 기기로 답한다.
            StringBuilder tickets = new StringBuilder("{\"data\":[");
            for (int index = 0; index < size; index++) {
                tickets.append(index == 0 ? "" : ",").append(index == size - 1
                        ? "{\"status\":\"error\",\"details\":{\"error\":\"DeviceNotRegistered\"}}"
                        : "{\"status\":\"ok\"}");
            }
            when(response.body()).thenReturn(tickets.append("]}").toString());
            return response;
        });
        List<PushMessage> messages = java.util.stream.IntStream.range(0, 101)
                .mapToObj(index -> new PushMessage("ExponentPushToken[" + index + "]", "완료", "분석 완료", Map.of()))
                .toList();

        List<String> unregistered = sender.send(messages);

        assertThat(requestSizes).containsExactly(100, 1);
        assertThat(unregistered).containsExactly("ExponentPushToken[99]", "ExponentPushToken[100]");
        assertThat(reporter.reports()).isEmpty();
    }

    /** {@link java.net.http.HttpRequest} 의 본문을 읽는다 — 공개 API 는 Flow.Publisher 로만 내준다. */
    private record BodySubscriber(java.net.http.HttpRequest request) {
        byte[] bytes() throws Exception {
            var collected = new java.io.ByteArrayOutputStream();
            var done = new java.util.concurrent.CompletableFuture<Void>();
            request.bodyPublisher().orElseThrow().subscribe(new java.util.concurrent.Flow.Subscriber<>() {
                public void onSubscribe(java.util.concurrent.Flow.Subscription subscription) {
                    subscription.request(Long.MAX_VALUE);
                }
                public void onNext(java.nio.ByteBuffer item) {
                    byte[] chunk = new byte[item.remaining()];
                    item.get(chunk);
                    collected.writeBytes(chunk);
                }
                public void onError(Throwable throwable) {
                    done.completeExceptionally(throwable);
                }
                public void onComplete() {
                    done.complete(null);
                }
            });
            done.get();
            return collected.toByteArray();
        }
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
