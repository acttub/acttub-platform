package com.acttub.actingapi.feature.push.adapter.expo;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.List;
import java.util.logging.Level;
import java.util.logging.Logger;

import com.acttub.actingapi.feature.push.app.PushMessage;
import com.acttub.actingapi.feature.push.app.PushSender;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * Expo Push API 로 보낸다. 토큰 하나로 iOS·Android 둘 다 커버되고 별도 인증이 없다 —
 * APNs·FCM 자격은 EAS 프로젝트가 들고 있고, 이 서버는 Expo 에 위탁만 한다.
 *
 * <p>실패는 전부 로그로 삼킨다({@link PushSender} 계약). 재시도도 하지 않는다 — 알림은
 * 최선 노력이고, 놓친 알림의 대체 경로(앱을 열면 홈이 이어서 안내)가 이미 있다.
 */
@Component
class ExpoPushSender implements PushSender {

    private static final Logger LOGGER = Logger.getLogger(ExpoPushSender.class.getName());
    private static final Duration TIMEOUT = Duration.ofSeconds(10);

    private final HttpClient http;
    private final ObjectMapper json;
    private final URI endpoint;

    ExpoPushSender(
            ObjectMapper json,
            @Value("${EXPO_PUSH_URL:https://exp.host/--/api/v2/push/send}") String endpoint) {
        this.http = HttpClient.newBuilder().connectTimeout(TIMEOUT).build();
        this.json = json;
        this.endpoint = URI.create(endpoint);
    }

    @Override
    public void send(List<PushMessage> messages) {
        if (messages.isEmpty()) {
            return;
        }
        try {
            HttpRequest request = HttpRequest.newBuilder(endpoint)
                    .timeout(TIMEOUT)
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(json.writeValueAsString(messages)))
                    .build();
            HttpResponse<String> response = http.send(
                    request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() / 100 != 2) {
                LOGGER.warning("expo push rejected: HTTP " + response.statusCode()
                        + " body=" + response.body());
            }
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            LOGGER.warning("expo push interrupted");
        } catch (Exception exception) {
            LOGGER.log(Level.WARNING, "expo push failed", exception);
        }
    }
}
