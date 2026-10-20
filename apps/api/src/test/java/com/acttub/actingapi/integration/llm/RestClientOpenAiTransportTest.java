package com.acttub.actingapi.integration.llm;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.Test;

/** 실제 HTTP 로 OpenAI 전송기를 본다 — 헤더와 본문이 그대로 나가고, 오류 상태도 본문째 돌아온다. */
class RestClientOpenAiTransportTest {
    private static final ObjectMapper JSON = new ObjectMapper();

    @Test
    void postsTheJsonBodyWithTheHeadersAndReturnsStatusAndBodyEvenForErrors() throws Exception {
        AtomicReference<String> seen = new AtomicReference<>();
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/v1/responses", exchange -> {
            seen.set(exchange.getRequestMethod() + " " + exchange.getRequestHeaders().getFirst("Authorization") + " "
                    + new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            byte[] body = "{\"error\":\"busy\"}".getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(429, body.length);
            exchange.getResponseBody().write(body);
            exchange.close();
        });
        server.start();
        try {
            Map<String, String> headers = new LinkedHashMap<>();
            headers.put("Authorization", "Bearer k");
            headers.put("Content-Type", "application/json");
            OpenAiHttpResponse response = new RestClientOpenAiTransport(Duration.ofSeconds(5)).exchange(
                    new OpenAiHttpRequest(URI.create("http://127.0.0.1:" + server.getAddress().getPort() + "/v1/responses"),
                            headers, JSON.readTree("{\"model\":\"m\",\"input\":\"안녕\"}")));

            assertThat(response).isEqualTo(new OpenAiHttpResponse(429, "{\"error\":\"busy\"}"));
            assertThat(seen.get()).isEqualTo("POST Bearer k {\"model\":\"m\",\"input\":\"안녕\"}");
        } finally {
            server.stop(0);
        }
    }

    @Test
    void unreachableServerIsAnIoFailure() throws Exception {
        int port;
        try (ServerSocket socket = new ServerSocket(0)) {
            port = socket.getLocalPort();
        }
        Map<String, String> headers = Map.of("Content-Type", "application/json");

        assertThatThrownBy(() -> new RestClientOpenAiTransport(Duration.ofSeconds(2), Duration.ofSeconds(2)).exchange(
                new OpenAiHttpRequest(URI.create("http://127.0.0.1:" + port + "/v1/responses"), headers,
                        JSON.readTree("{}"))))
                .isInstanceOf(IOException.class);
    }
}
