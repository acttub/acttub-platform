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
import com.acttub.actingapi.platform.json.LenientJson;

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
            assertThat(LenientJson.asText(contents.get(0).path("parts").get(0).path("fileData").path("fileUri")))
                    .isEqualTo("https://example.test/video");
            assertThat(LenientJson.asText(contents.get(1).path("role"))).isEqualTo("model");
            assertThat(LenientJson.asText(contents.get(2).path("parts").get(0).path("text"))).isEqualTo("배우의 답");
            assertThat(LenientJson.asText(request.get().path("systemInstruction").path("parts").get(0).path("text")))
                    .isEqualTo("코칭 지침");
            assertThat(request.get().path("generationConfig").has("responseMimeType")).isFalse();
            model.classify(List.of(new DirectVideoModel.Message("model", "첫 질문"),
                            new DirectVideoModel.Message("user", "배우의 답")), "분류 지침", List.of("intention", "correction", "unsure", "method", "acknowledgement", "other"));
            JsonNode config = request.get().path("generationConfig");
            assertThat(LenientJson.asText(config.path("responseMimeType"))).isEqualTo("application/json");
            assertThat(config.path("responseJsonSchema").path("properties").path("signals").path("items").path("enum").size())
                    .isEqualTo(6);
            assertThat(LenientJson.asText(config.path("responseJsonSchema").path("properties").path("signals").path("items").path("enum").get(5)))
                    .isEqualTo("other");
            assertThat(request.get().path("contents")).hasSize(1);
            assertThat(LenientJson.asText(request.get().path("contents").get(0).path("role"))).isEqualTo("user");
            JsonNode transcript = mapper.readTree(LenientJson.asText(request.get().path("contents").get(0).path("parts").get(0).path("text")));
            assertThat(transcript).hasSize(2);
            assertThat(LenientJson.asText(transcript.get(0).path("role"))).isEqualTo("model");
            assertThat(LenientJson.asText(transcript.get(1).path("role"))).isEqualTo("user");
            assertThat(LenientJson.asText(transcript.get(1).path("text"))).isEqualTo("배우의 답");
            assertThat(request.get().path("contents").toString()).doesNotContain("fileData", "fileUri", "https://example.test/video");
            assertThat(LenientJson.asText(request.get().path("systemInstruction").path("parts").get(0).path("text"))).isEqualTo("분류 지침");
        } finally { server.stop(0); }
    }

    @Test void coachRepliesStopAtTheOutputLimitAndACutReplyCountsAsEmpty() throws Exception {
        var request = new AtomicReference<JsonNode>();
        var mapper = new ObjectMapper();
        var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> {
            request.set(mapper.readTree(exchange.getRequestBody()));
            byte[] response = """
                    {"candidates":[{"content":{"parts":[{"text":"<생각>\\n배우가 한 말: 끊긴"}],"role":"model"},"finishReason":"MAX_TOKENS"}]}
                    """.getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, response.length);
            exchange.getResponseBody().write(response);
            exchange.close();
        });
        server.start();
        try (var client = Client.builder().apiKey("not-a-real-key").httpOptions(HttpOptions.builder()
                .baseUrl("http://127.0.0.1:" + server.getAddress().getPort()).build()).build()) {
            var model = new GeminiDirectVideoModel(client, "gemini-3.8-flash");
            org.assertj.core.api.Assertions.assertThatThrownBy(() -> model.reply(
                            new DirectVideoModel.Video("files/test", "https://example.test/video", "video/mp4"),
                            List.of(new DirectVideoModel.Message("user", "배우의 답")), "코칭 지침"))
                    .isInstanceOf(IllegalStateException.class).hasMessageContaining("empty");
            JsonNode config = request.get().path("generationConfig");
            assertThat(LenientJson.asInt(config.path("maxOutputTokens"))).isEqualTo(GeminiDirectVideoModel.REPLY_TOKEN_LIMIT).isEqualTo(4096);
            assertThat(LenientJson.asText(config.path("thinkingConfig").path("thinkingLevel"))).isEqualTo("LOW");
        } finally { server.stop(0); }
    }
}
