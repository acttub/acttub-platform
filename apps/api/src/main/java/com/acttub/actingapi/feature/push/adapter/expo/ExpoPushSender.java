package com.acttub.actingapi.feature.push.adapter.expo;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.TreeSet;
import java.util.logging.Level;
import java.util.logging.Logger;

import com.acttub.actingapi.feature.push.app.PushMessage;
import com.acttub.actingapi.feature.push.app.PushSender;
import com.acttub.actingapi.platform.observability.FailureContext;
import com.acttub.actingapi.platform.observability.FailureKind;
import com.acttub.actingapi.platform.observability.FailureReporter;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * Expo Push API 로 보낸다. 토큰 하나로 iOS·Android 둘 다 커버되고 별도 인증이 없다 —
 * APNs·FCM 자격은 EAS 프로젝트가 들고 있고, 이 서버는 Expo 에 위탁만 한다.
 *
 * <p>실패는 호출 결과에서는 삼키고 운영자에게 보고한다({@link PushSender} 계약). 연결 실패 같은
 * 일시 오류만 짧게 두 번 더 시도하고(백오프), 그래도 실패하면 경고 로그만 남긴다 — 알림은 최선 노력이고, 놓친 알림의 대체 경로(앱을 열면 홈이 이어서 안내)가 이미 있다.
 */
@Component
class ExpoPushSender implements PushSender {

    private static final Logger LOGGER = Logger.getLogger(ExpoPushSender.class.getName());
    private static final Duration TIMEOUT = Duration.ofSeconds(10);
    /** Expo 는 요청 하나에 메시지를 100건까지 받고, 넘으면 요청 전체를 HTTP 400 으로 거절한다. */
    private static final int MAX_MESSAGES_PER_REQUEST = 100;

    private static final int MAX_ATTEMPTS = 3;
    private static final long[] BACKOFF_MILLIS = {300, 1000};

    private final RequestSender sender;
    private final ObjectMapper json;
    private final URI endpoint;
    private final FailureReporter failureReporter;

    @Autowired
    ExpoPushSender(
            ObjectMapper json,
            @Value("${EXPO_PUSH_URL:https://exp.host/--/api/v2/push/send}") String endpoint,
            FailureReporter failureReporter) {
        this(json, endpoint, failureReporter, defaultSender());
    }

    ExpoPushSender(
            ObjectMapper json,
            String endpoint,
            FailureReporter failureReporter,
            RequestSender sender) {
        this.json = json;
        this.endpoint = URI.create(endpoint);
        this.failureReporter = failureReporter;
        this.sender = sender;
    }

    @Override
    public List<String> send(List<PushMessage> messages) {
        List<String> unregistered = new ArrayList<>();
        // 중단 신호를 받으면 남은 요청은 보내지 않는다.
        for (int from = 0; from < messages.size() && !Thread.currentThread().isInterrupted();
                from += MAX_MESSAGES_PER_REQUEST) {
            unregistered.addAll(sendChunk(
                    messages.subList(from, Math.min(from + MAX_MESSAGES_PER_REQUEST, messages.size()))));
        }
        return unregistered;
    }

    private List<String> sendChunk(List<PushMessage> messages) {
        try {
            HttpRequest request = HttpRequest.newBuilder(endpoint)
                    .timeout(TIMEOUT)
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(json.writeValueAsString(messages)))
                    .build();
            HttpResponse<String> response = sendWithRetry(request);
            if (response.statusCode() / 100 != 2) {
                LOGGER.warning("expo push rejected: HTTP " + response.statusCode());
                failureReporter.report(
                        new IllegalStateException(
                                "expo push rejected with HTTP " + response.statusCode()),
                        FailureKind.EXTERNAL,
                        new FailureContext("ExpoPushSender.send"));
                return List.of();
            }
            return unregisteredDevices(messages, response.body());
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            LOGGER.warning("expo push interrupted");
        } catch (java.io.IOException exception) {
            // 재시도 뒤에도 연결이 안 되는 일시 오류는 경고 로그만 남긴다. 놓친 알림은 앱을 열면 홈이 이어서 안내한다.
            LOGGER.log(Level.WARNING, "expo push unreachable after " + MAX_ATTEMPTS + " attempts", exception);
        } catch (Exception exception) {
            LOGGER.log(Level.WARNING, "expo push failed", exception);
            failureReporter.report(
                    exception,
                    FailureKind.EXTERNAL,
                    new FailureContext("ExpoPushSender.send"));
        }
        return List.of();
    }

    /** 연결 실패·입출력 오류만 다시 시도한다. HTTP 응답이 온 경우는 그대로 돌려준다. */
    private HttpResponse<String> sendWithRetry(HttpRequest request) throws Exception {
        for (int attempt = 1; ; attempt++) {
            try {
                return sender.send(request);
            } catch (java.io.IOException exception) {
                if (attempt >= MAX_ATTEMPTS) throw exception;
                LOGGER.log(Level.FINE, "expo push attempt " + attempt + " failed, retrying", exception);
                Thread.sleep(backoffMillis(attempt));
            }
        }
    }

    long backoffMillis(int attempt) {
        return BACKOFF_MILLIS[attempt - 1];
    }

    /**
     * Expo 는 보낸 순서대로 ticket 을 돌려준다({@code data[i]} 가 {@code messages[i]} 의 것).
     * {@code details.error} 가 {@code DeviceNotRegistered} 면 그 기기는 더는 알림을 받지 못한다 — Expo
     * 문서는 그 토큰으로 보내기를 멈추라고 한다. 읽지 못한 응답은 "그런 기기 없음"으로 본다.
     *
     * <p>읽지 못한 응답과 그 밖의 ticket 오류(너무 큰 메시지, 자격 오류, 한도 초과)는 바깥 의존의 실패다 —
     * 발송은 그대로 끝내되 삼키지 않고 보고한다 (ADR-025). 본문과 토큰은 보고에 싣지 않고 오류의 종류만 싣는다.
     */
    private List<String> unregisteredDevices(List<PushMessage> messages, String body) {
        JsonNode tickets;
        try {
            tickets = json.readTree(body).path("data");
        } catch (Exception unreadable) {
            tickets = null;
        }
        if (tickets == null || !tickets.isArray()) {
            reportTickets("expo push tickets are unreadable");
            return List.of();
        }
        List<String> unregistered = new ArrayList<>();
        Set<String> otherErrors = new TreeSet<>();
        for (int index = 0; index < tickets.size() && index < messages.size(); index++) {
            JsonNode ticket = tickets.get(index);
            if (!"error".equals(ticket.path("status").asText())) {
                continue;
            }
            String error = ticket.path("details").path("error").asText("unknown");
            if ("DeviceNotRegistered".equals(error)) {
                unregistered.add(messages.get(index).to());
            } else {
                otherErrors.add(error);
            }
        }
        if (!otherErrors.isEmpty()) {
            reportTickets("expo push tickets reported errors: " + otherErrors);
        }
        return unregistered;
    }

    private void reportTickets(String what) {
        LOGGER.warning(what);
        failureReporter.report(
                new IllegalStateException(what), FailureKind.EXTERNAL, new FailureContext("ExpoPushSender.tickets"));
    }

    private static RequestSender defaultSender() {
        HttpClient http = HttpClient.newBuilder().connectTimeout(TIMEOUT).build();
        return request -> http.send(request, HttpResponse.BodyHandlers.ofString());
    }

    @FunctionalInterface
    interface RequestSender {
        HttpResponse<String> send(HttpRequest request) throws Exception;
    }
}
