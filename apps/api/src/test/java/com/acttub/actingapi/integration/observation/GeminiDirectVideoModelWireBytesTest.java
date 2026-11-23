package com.acttub.actingapi.integration.observation;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import com.google.genai.Client;
import com.google.genai.types.HttpOptions;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import com.acttub.actingapi.platform.json.LenientJson;

/**
 * 분류 요청에서 우리 코드가 Gemini SDK 에 넘기는 값을 고정한다. 대화 기록은 우리 코드가 JSON 글로 만들어 넘기므로 그 글을
 * 바이트 그대로 본다. 응답 스키마는 맵으로 넘기고 SDK 가 직렬화한다. 그 맵은 {@code Map.of} 라 키 순서가 JVM 마다 달라
 * 지금도 바이트가 고정돼 있지 않으므로 내용만 본다.
 */
class GeminiDirectVideoModelWireBytesTest {
    private static final ObjectMapper JSON = new ObjectMapper();
    /** 한글, 따옴표, 빗금, 역빗금, 줄바꿈, 탭, 제어 문자, 이모지. */
    private static final String TRICKY = "따옴표\"와 빗금/와 역빗금\\ 줄\n탭\t제어\u001f 이모지😀";

    private final List<byte[]> bodies = new ArrayList<>();
    private HttpServer server;
    private Client client;

    @BeforeEach
    void start() throws Exception {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> {
            bodies.add(exchange.getRequestBody().readAllBytes());
            byte[] out = "{\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"{\\\"signals\\\":[]}\"}],\"role\":\"model\"}}]}"
                    .getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, out.length);
            exchange.getResponseBody().write(out);
            exchange.close();
        });
        server.start();
        client = Client.builder().apiKey("not-a-real-key").httpOptions(HttpOptions.builder()
                .baseUrl("http://127.0.0.1:" + server.getAddress().getPort()).build()).build();
    }

    @AfterEach
    void stop() {
        client.close();
        server.stop(0);
    }

    @Test
    @DisplayName("분류 요청의 대화 기록 글은 role, text 순서의 JSON 배열 글로 정해진 바이트다")
    void classifyTranscriptAndSchema() throws Exception {
        GeminiDirectVideoModel model = new GeminiDirectVideoModel(client, "gemini-3-flash-preview");

        model.classify(List.of(new DirectVideoModel.Message("model", "첫 질문 \"왜\"/어떻게"),
                new DirectVideoModel.Message("user", TRICKY)), "분류 지침", List.of("answered", "asked_back"));

        assertThat(bodies).hasSize(1);
        JsonNode request = JSON.readTree(bodies.getFirst());
        assertThat(LenientJson.asText(request.path("contents").path(0).path("parts").path(0).path("text"))).isEqualTo("""
                [{"role":"model","text":"첫 질문 \\"왜\\"/어떻게"},\
                {"role":"user","text":"따옴표\\"와 빗금/와 역빗금\\\\ 줄\\n탭\\t제어\\u001F 이모지😀"}]""");
        assertThat(request.path("generationConfig").path("responseJsonSchema")).isEqualTo(JSON.readTree("""
                {"type":"object","properties":{"signals":{"type":"array","items":{"type":"string","enum":["answered","asked_back"]}}},
                 "required":["signals"],"additionalProperties":false}"""));
    }
}
