package com.acttub.actingapi.integration.airbridge;

import java.net.http.HttpClient;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Optional;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

/**
 * Airbridge 귀속 조회 API 의 실물. {@code GET /attribution-result/v1/apps/{앱 이름}/mobile-app?device_uuid=…} 를
 * {@code Authorization: Bearer <API 토큰>} 으로 부른다. 200 이면 {@code data.attributedChannel} 등을, 204 면 아직 결과가 없다.
 *
 * <p>토큰과 기기 ID 는 로그에도 예외 메시지에도 싣지 않는다.
 */
@Component
public class HttpAirbridgeAttributionClient implements AirbridgeAttributionClient {
    static final String BASE_URL = "https://api.airbridge.io";
    private static final Duration TIMEOUT = Duration.ofSeconds(5);
    private static final ObjectMapper JSON = new ObjectMapper();

    private final String token;
    private final String appName;
    private final RestClient http;

    @Autowired
    public HttpAirbridgeAttributionClient(
            @Value("${AIRBRIDGE_API_TOKEN:}") String token, @Value("${AIRBRIDGE_APP_NAME:acttub}") String appName) {
        this(token, appName, builder());
    }

    public HttpAirbridgeAttributionClient(String token, String appName, RestClient.Builder http) {
        this.token = token == null ? "" : token.strip();
        this.appName = appName == null || appName.isBlank() ? "acttub" : appName.strip();
        this.http = http.build();
    }

    private static RestClient.Builder builder() {
        JdkClientHttpRequestFactory factory = new JdkClientHttpRequestFactory(HttpClient.newBuilder()
                .version(HttpClient.Version.HTTP_1_1)
                .connectTimeout(TIMEOUT)
                .build());
        factory.setReadTimeout(TIMEOUT);
        return RestClient.builder().requestFactory(factory);
    }

    @Override
    public boolean enabled() {
        return !token.isEmpty();
    }

    @Override
    public Optional<AirbridgeAttribution> lookup(String deviceUuid) {
        if (!enabled()) {
            throw new AirbridgeUnavailable("AIRBRIDGE_API_TOKEN not configured");
        }
        int status;
        String body;
        try {
            record Reply(int status, String body) {
            }
            Reply reply = http.get()
                    .uri(BASE_URL + "/attribution-result/v1/apps/{app}/mobile-app?device_uuid={device}",
                            appName, deviceUuid)
                    .header("Authorization", "Bearer " + token)
                    .exchange((sent, response) -> new Reply(
                            response.getStatusCode().value(),
                            new String(response.getBody().readAllBytes(), StandardCharsets.UTF_8)));
            status = reply.status();
            body = reply.body();
        } catch (RestClientException failure) {
            // 원인 예외에 요청 주소(기기 ID)가 들어 있을 수 있어 붙이지 않는다.
            throw new AirbridgeUnavailable("airbridge did not answer");
        }
        if (status == 204) {
            return Optional.empty();
        }
        if (status != 200) {
            throw new AirbridgeUnavailable("airbridge answered " + status);
        }
        try {
            JsonNode data = JSON.readTree(body).path("data");
            String channel = text(data, "attributedChannel");
            if (channel == null) {
                return Optional.empty();
            }
            return Optional.of(new AirbridgeAttribution(
                    channel,
                    text(data, "attributedCampaign"),
                    text(data, "attributedAdGroup"),
                    text(data, "attributedAdCreative"),
                    text(data, "attributedContent"),
                    text(data, "attributedTerm"),
                    text(data, "attributedSubPublisher")));
        } catch (Exception notJson) {
            throw new AirbridgeUnavailable("airbridge answered something unreadable");
        }
    }

    /** 문자열이 아니거나 비어 있으면 {@code null}. */
    private static String text(JsonNode data, String field) {
        JsonNode value = data.path(field);
        if (!value.isTextual()) {
            return null;
        }
        String stripped = value.asText().strip();
        return stripped.isEmpty() ? null : stripped;
    }
}
