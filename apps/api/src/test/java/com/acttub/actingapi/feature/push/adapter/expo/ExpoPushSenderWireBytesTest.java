package com.acttub.actingapi.feature.push.adapter.expo;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import com.acttub.actingapi.feature.push.app.PushMessage;
import com.acttub.actingapi.platform.config.JacksonConfig;
import com.acttub.actingapi.support.FrozenValue;
import com.acttub.actingapi.support.RecordingFailureReporter;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.json.JsonTest;
import org.springframework.context.annotation.Import;

/**
 * Expo 로 나가는 알림 요청 본문을 바이트 그대로 고정한다. JSON 라이브러리를 바꿔도 같은 바이트가 나가야 한다.
 * 운영과 같은 ObjectMapper(앱 설정과 {@link JacksonConfig})로 직렬화하고, 실제 HTTP 로 받은 바이트를 본다.
 * 기대값은 {@code frozen/wire-bytes/expo-messages.json} 이고 마지막에 줄바꿈이 없다.
 */
@JsonTest
@Import(JacksonConfig.class)
class ExpoPushSenderWireBytesTest {
    /** 한글, 따옴표, 빗금, 역빗금, 줄바꿈, 탭, 제어 문자, 이모지. */
    private static final String TRICKY = "따옴표\"와 빗금/와 역빗금\\ 줄\n탭\t제어\u001f 이모지😀";

    @Autowired
    ObjectMapper objectMapper;

    private final List<byte[]> received = new ArrayList<>();
    private HttpServer server;

    @BeforeEach
    void start() throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/send", exchange -> {
            received.add(exchange.getRequestBody().readAllBytes());
            byte[] out = "{\"data\":[{\"status\":\"ok\"},{\"status\":\"ok\"},{\"status\":\"ok\"}]}"
                    .getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(200, out.length);
            exchange.getResponseBody().write(out);
            exchange.close();
        });
        server.start();
    }

    @AfterEach
    void stop() {
        server.stop(0);
    }

    @Test
    @DisplayName("알림 목록은 레코드 순서대로 쓰고 null 과 빈 맵도 키째 싣고 data 는 넣은 순서를 지킨다")
    void messagesBody() {
        Map<String, String> data = new LinkedHashMap<>();
        data.put("type", "coach");
        data.put("screen", TRICKY);
        ExpoPushSender sender = new ExpoPushSender(objectMapper,
                "http://127.0.0.1:" + server.getAddress().getPort() + "/send", new RecordingFailureReporter());

        sender.send(List.of(
                new PushMessage("ExponentPushToken[가짜-1]", TRICKY, "분석이 끝났어요", data),
                new PushMessage("ExponentPushToken[가짜-2]", null, "", null),
                new PushMessage("ExponentPushToken[가짜-3]", "제목", "본문", Map.of())));

        assertThat(received).hasSize(1);
        String expected = FrozenValue.of("wire-bytes/expo-messages.json");
        // channelId 와 sound 는 레코드 구성요소가 아니라 메서드에서 온 속성이다. 지금 코드에서 이 둘의 순서는 JVM 을 띄울 때마다
        // 바뀐다(같은 테스트를 다시 돌려 두 순서를 모두 봤다). 그래서 이 두 순서만 허락하고 나머지 바이트는 모두 같아야 한다.
        String swapped = expected.replace("\"channelId\":\"default\",\"sound\":\"default\"",
                "\"sound\":\"default\",\"channelId\":\"default\"");
        assertThat(received.getFirst()).asString(StandardCharsets.UTF_8).isIn(expected, swapped);
    }
}
