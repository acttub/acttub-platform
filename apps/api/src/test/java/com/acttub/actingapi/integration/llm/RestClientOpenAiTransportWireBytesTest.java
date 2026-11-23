package com.acttub.actingapi.integration.llm;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.InetSocketAddress;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import com.acttub.actingapi.support.FrozenValue;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * OpenAI 로 나가는 요청 본문을 바이트 그대로 고정한다. 이 바이트는 RestClient 의 JSON 변환기가 JsonNode 를 직렬화한
 * 것이다. 기존 {@link RestClientOpenAiTransportTest} 는 한글 글 하나만 보므로, null, 중첩 객체, 빈 배열, 정수, 소수,
 * 큰 long, 참거짓, 특수 문자를 여기서 본다. 기대값은 {@code frozen/wire-bytes/openai-responses.json} 이고 마지막에
 * 줄바꿈이 없다.
 */
class RestClientOpenAiTransportWireBytesTest {
    private static final ObjectMapper JSON = new ObjectMapper();
    /** 한글, 따옴표, 빗금, 역빗금, 줄바꿈, 탭, 제어 문자, 이모지. */
    private static final String TRICKY = "따옴표\"와 빗금/와 역빗금\\ 줄\n탭\t제어\u001f 이모지😀";

    @Test
    @DisplayName("요청 JsonNode 는 넣은 순서와 값 그대로 정해진 바이트로 나가고 Content-Type 은 요청 헤더 그대로다")
    void responsesBody() throws Exception {
        List<byte[]> bodies = new ArrayList<>();
        List<String> contentTypes = new ArrayList<>();
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/v1/responses", exchange -> {
            contentTypes.add(exchange.getRequestHeaders().getFirst("Content-Type"));
            bodies.add(exchange.getRequestBody().readAllBytes());
            byte[] out = "{}".getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(200, out.length);
            exchange.getResponseBody().write(out);
            exchange.close();
        });
        server.start();
        ObjectNode body = JSON.createObjectNode();
        body.put("model", "gpt-6-luna");
        body.put("instructions", TRICKY);
        body.put("input", "안녕");
        body.put("store", false);
        body.put("max_output_tokens", 200);
        body.put("temperature", 0.5);
        body.put("top_p", 2.0);
        body.put("seed", 9_007_199_254_740_993L);
        body.putNull("previous_response_id");
        body.putObject("reasoning").put("effort", "low");
        ObjectNode format = body.putObject("text").putObject("format");
        format.put("type", "json_schema").put("name", "note").put("strict", true);
        ObjectNode schema = format.putObject("schema");
        schema.put("type", "object");
        schema.putObject("properties").putObject("score").put("type", "number").put("minimum", 0).put("maximum", 1.0);
        schema.putArray("required");
        schema.put("additionalProperties", false);
        Map<String, String> headers = new LinkedHashMap<>();
        headers.put("Authorization", "Bearer not-a-real-key");
        headers.put("Content-Type", "application/json");
        try {
            new RestClientOpenAiTransport(Duration.ofSeconds(5)).exchange(new OpenAiHttpRequest(
                    URI.create("http://127.0.0.1:" + server.getAddress().getPort() + "/v1/responses"), headers, body));
        } finally {
            server.stop(0);
        }

        assertThat(contentTypes).containsExactly("application/json");
        // 이모지는 지금 서로게이트 쌍 이스케이프로 나간다(JsonNode 를 바이트로 바로 쓰는 경로).
        assertThat(bodies.getFirst()).asString(StandardCharsets.UTF_8)
                .isEqualTo(FrozenValue.of("wire-bytes/openai-responses.json"));
    }
}
