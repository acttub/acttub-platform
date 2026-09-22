package com.acttub.actingapi.integration.observation;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.atomic.AtomicReference;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.google.genai.Client;
import com.google.genai.types.HttpOptions;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.Test;

class GeminiDirectVideoModelTest {
    @Test void sendsOriginalVideoAndConversationInTheActualGeminiHttpRequest() throws Exception {
        var request = new AtomicReference<JsonNode>();
        var mapper = new ObjectMapper();
        var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> {
            request.set(mapper.readTree(exchange.getRequestBody()));
            byte[] response = """
                    {"candidates":[{"content":{"parts":[{"text":"다음 답변"}],"role":"model"},"finishReason":"STOP"}]}
                    """.getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, response.length);
            exchange.getResponseBody().write(response);
            exchange.close();
        });
        server.start();
        try (var client = Client.builder().apiKey("not-a-real-key").httpOptions(HttpOptions.builder()
                .baseUrl("http://127.0.0.1:" + server.getAddress().getPort()).build()).build()) {
            var model = new GeminiDirectVideoModel(client, "gemini-3-flash-preview");
            String reply = model.reply(new DirectVideoModel.Video("files/test", "https://example.test/video", "video/mp4"),
                    List.of(new DirectVideoModel.Message("model", "첫 질문"),
                            new DirectVideoModel.Message("user", "배우의 답")), "코칭 지침");
            assertThat(reply).isEqualTo("다음 답변");
            JsonNode contents = request.get().path("contents");
            assertThat(contents.size()).isEqualTo(3);
            assertThat(contents.get(0).path("parts").size()).isEqualTo(1);
            assertThat(contents.get(0).path("parts").get(0).has("text")).isFalse();
            assertThat(contents.get(0).path("parts").get(0).path("fileData").path("fileUri").asText())
                    .isEqualTo("https://example.test/video");
            assertThat(contents.get(1).path("role").asText()).isEqualTo("model");
            assertThat(contents.get(2).path("parts").get(0).path("text").asText()).isEqualTo("배우의 답");
            assertThat(request.get().path("systemInstruction").path("parts").get(0).path("text").asText())
                    .isEqualTo("코칭 지침");
            assertThat(request.get().path("generationConfig").has("responseMimeType")).isFalse();
            model.classify(new DirectVideoModel.Video("files/test", "https://example.test/video", "video/mp4"),
                    List.of(new DirectVideoModel.Message("model", "첫 질문"),
                            new DirectVideoModel.Message("user", "배우의 답")), "분류 지침");
            JsonNode config = request.get().path("generationConfig");
            assertThat(config.path("responseMimeType").asText()).isEqualTo("application/json");
            assertThat(config.path("responseJsonSchema").path("properties").path("route").path("enum").size())
                    .isEqualTo(4);
        } finally { server.stop(0); }
    }
}
