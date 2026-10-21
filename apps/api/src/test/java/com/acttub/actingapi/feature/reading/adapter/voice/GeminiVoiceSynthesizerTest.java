package com.acttub.actingapi.feature.reading.adapter.voice;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.concurrent.atomic.AtomicReference;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.google.genai.Client;
import com.google.genai.types.HttpOptions;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.Test;

/** reading.cloud-voice: Gemini TTS 에는 대사 원문 하나와 고른 목소리만 보내고, 돌아온 PCM 바이트를 그대로 쓴다. */
class GeminiVoiceSynthesizerTest {
    @Test void sendsOnlyTheLineAndVoiceAndReturnsTheAudioBytes() throws Exception {
        var request = new AtomicReference<JsonNode>();
        var path = new AtomicReference<String>();
        var mapper = new ObjectMapper();
        byte[] pcm = {0, 1, 2, 3, 4};
        var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> {
            path.set(exchange.getRequestURI().getPath());
            request.set(mapper.readTree(exchange.getRequestBody()));
            byte[] response = ("{\"candidates\":[{\"content\":{\"parts\":[{\"inlineData\":{\"mimeType\":\"audio/L16;rate=24000\",\"data\":\""
                    + Base64.getEncoder().encodeToString(pcm) + "\"}}],\"role\":\"model\"},\"finishReason\":\"STOP\"}]}")
                    .getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, response.length);
            exchange.getResponseBody().write(response);
            exchange.close();
        });
        server.start();
        try (var client = Client.builder().apiKey("not-a-real-key").httpOptions(HttpOptions.builder()
                .baseUrl("http://127.0.0.1:" + server.getAddress().getPort()).build()).build()) {
            byte[] audio = new GeminiVoiceSynthesizer(client, "gemini-tts-test").synthesizePcm("가지 마.", "Kore");
            assertThat(audio).containsExactly(pcm);
            assertThat(path.get()).endsWith("/models/gemini-tts-test:generateContent");
            assertThat(request.get().path("contents")).hasSize(1);
            assertThat(request.get().path("contents").get(0).path("parts").get(0).path("text").asText()).isEqualTo("가지 마.");
            JsonNode config = request.get().path("generationConfig");
            assertThat(config.path("responseModalities").toString()).isEqualTo("[\"AUDIO\"]");
            assertThat(config.path("speechConfig").path("voiceConfig").path("prebuiltVoiceConfig").path("voiceName").asText())
                    .isEqualTo("Kore");
        } finally {
            server.stop(0);
        }
    }
}
