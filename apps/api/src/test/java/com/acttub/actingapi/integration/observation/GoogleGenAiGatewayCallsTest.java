package com.acttub.actingapi.integration.observation;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.io.UncheckedIOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

import com.google.genai.Client;
import com.google.genai.types.Content;
import com.google.genai.types.GenerateContentConfig;
import com.google.genai.types.HttpOptions;
import com.google.genai.types.Part;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.Test;

/** 파일 조회·생성·삭제가 Gemini 의 해당 경로로 가고, 상태가 비면 처리 중으로 읽는다. 가짜 Gemini 서버로 본다. */
class GoogleGenAiGatewayCallsTest {

    @Test
    void getGenerateAndDeleteReachGeminiAndMissingFieldsGetDefaults() throws Exception {
        List<String> requests = new ArrayList<>();
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> {
            exchange.getRequestBody().readAllBytes();
            String path = exchange.getRequestURI().getPath();
            requests.add(exchange.getRequestMethod() + " " + path);
            String body = path.endsWith(":generateContent")
                    ? "{\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"관찰\"}],\"role\":\"model\"}}]}"
                    : path.endsWith("files/take") && "GET".equals(exchange.getRequestMethod())
                            ? "{\"name\":\"files/take\"}" : "{}";
            byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, bytes.length);
            exchange.getResponseBody().write(bytes);
            exchange.close();
        });
        server.start();
        try (var client = Client.builder().apiKey("test-key").httpOptions(HttpOptions.builder()
                .baseUrl("http://127.0.0.1:" + server.getAddress().getPort()).build()).build()) {
            GoogleGenAiGateway gateway = new GoogleGenAiGateway(client);

            GeminiFile file = gateway.get("files/take");
            String text = gateway.generateResponse("gemini-3-flash-preview",
                    Content.fromParts(Part.fromText("영상을 보라")), GenerateContentConfig.builder().build()).text();
            gateway.delete("files/take");

            assertThat(file).isEqualTo(new GeminiFile("files/take", null, null, "PROCESSING"));
            assertThat(text).isEqualTo("관찰");
            assertThat(requests).containsExactly(
                    "GET /v1beta/files/take",
                    "POST /v1beta/models/gemini-3-flash-preview:generateContent",
                    "DELETE /v1beta/files/take");
        } finally {
            server.stop(0);
        }
    }

    @Test
    void unreadableMediaFailsBeforeAnyUpload() {
        try (var client = Client.builder().apiKey("test-key")
                .httpOptions(HttpOptions.builder().baseUrl("http://127.0.0.1:9").build()).build()) {
            assertThatThrownBy(() -> new GoogleGenAiGateway(client).upload(Path.of("build", "no-such-media.mp4"), "video/mp4"))
                    .isInstanceOf(UncheckedIOException.class)
                    .hasMessage("failed to read media for upload");
        }
    }
}
