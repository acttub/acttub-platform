package com.acttub.actingapi.feature.push.adapter.expo;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
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
 * <p>실패는 호출 결과에서는 삼키고 운영자에게 보고한다({@link PushSender} 계약). 재시도도 하지
 * 않는다 — 알림은 최선 노력이고, 놓친 알림의 대체 경로(앱을 열면 홈이 이어서 안내)가 이미 있다.
 */
@Component
class ExpoPushSender implements PushSender {

    private static final Logger LOGGER = Logger.getLogger(ExpoPushSender.class.getName());
    private static final Duration TIMEOUT = Duration.ofSeconds(10);

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
        if (messages.isEmpty()) {
            return List.of();
        }
        try {
            HttpRequest request = HttpRequest.newBuilder(endpoint)
                    .timeout(TIMEOUT)
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(json.writeValueAsString(messages)))
                    .build();
            HttpResponse<String> response = sender.send(request);
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
        } catch (Exception exception) {
            LOGGER.log(Level.WARNING, "expo push failed", exception);
            failureReporter.report(
                    exception,
                    FailureKind.EXTERNAL,
                    new FailureContext("ExpoPushSender.send"));
        }
        return List.of();
    }

    /**
     * Expo 는 보낸 순서대로 ticket 을 돌려준다({@code data[i]} 가 {@code messages[i]} 의 것).
     * {@code details.error} 가 {@code DeviceNotRegistered} 면 그 기기는 더는 알림을 받지 못한다 — Expo
     * 문서는 그 토큰으로 보내기를 멈추라고 한다. 읽지 못한 응답은 "그런 기기 없음"으로 본다.
     */
    private List<String> unregisteredDevices(List<PushMessage> messages, String body) {
        try {
            JsonNode tickets = json.readTree(body).path("data");
            List<String> unregistered = new ArrayList<>();
            for (int index = 0; index < tickets.size() && index < messages.size(); index++) {
                JsonNode ticket = tickets.get(index);
                if ("error".equals(ticket.path("status").asText())
                        && "DeviceNotRegistered".equals(ticket.path("details").path("error").asText())) {
                    unregistered.add(messages.get(index).to());
                }
            }
            return unregistered;
        } catch (Exception unreadable) {
            return List.of();
        }
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
