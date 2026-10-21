package com.acttub.actingapi.feature.reading.adapter.pron;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.concurrent.atomic.AtomicReference;

import com.acttub.actingapi.feature.reading.app.PronunciationScorer.Scored;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** 채점 서비스 호출: multipart 로 녹음·대본을 보내고, 응답을 줄 채점 결과로 읽으며, 실패는 던진다(SOMA-606). */
class HttpPronunciationScorerTest {
    private static final String OK_BODY = """
            {"scored_text":"다리가 아파","model_version":"slplab-test","words":[
              {"index":0,"word":"다리가","number":false,"phones":[
                {"expected":"ㄹ","heard":"ㄴ","lpr":-5.2,"vowel":false,"syllable":1,"start_ms":120,"end_ms":180,"flagged":true},
                {"expected":"ㅏ","heard":"ㅏ","lpr":1.0,"vowel":true,"syllable":null,"start_ms":null,"end_ms":null,"flagged":false}]},
              {"index":1,"word":"육십","number":true,"phones":[]}]}
            """;

    @TempDir
    Path dir;
    HttpServer server;
    final AtomicReference<String> received = new AtomicReference<>();
    final AtomicReference<String> contentType = new AtomicReference<>();
    int status = 200;
    String body = OK_BODY;

    @BeforeEach
    void start() throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/score", exchange -> {
            received.set(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            contentType.set(exchange.getRequestHeaders().getFirst("Content-Type"));
            byte[] out = body.getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(status, out.length);
            try (OutputStream stream = exchange.getResponseBody()) {
                stream.write(out);
            }
        });
        server.start();
    }

    @AfterEach
    void stop() {
        server.stop(0);
    }

    private HttpPronunciationScorer scorer() {
        return new HttpPronunciationScorer("http://127.0.0.1:" + server.getAddress().getPort() + "//", new ObjectMapper());
    }

    private Path audio() throws IOException {
        return Files.writeString(dir.resolve("line.m4a"), "AUDIO-BYTES");
    }

    @Test
    void 녹음과_대본을_multipart_로_보내고_응답을_읽는다() throws IOException {
        Scored scored = scorer().score(audio(), "audio/mp4", "다리가 아파");

        assertThat(contentType.get()).startsWith("multipart/form-data; boundary=pron-");
        assertThat(received.get()).contains("name=\"audio\"; filename=\"line.m4a\"", "Content-Type: audio/mp4", "AUDIO-BYTES",
                "name=\"text\"", "다리가 아파");
        assertThat(scored.modelVersion()).isEqualTo("slplab-test");
        assertThat(scored.line().scoredText()).isEqualTo("다리가 아파");
        assertThat(scored.line().words()).hasSize(2);
        var first = scored.line().words().get(0).phones().get(0);
        assertThat(first.expected()).isEqualTo("ㄹ");
        assertThat(first.heard()).isEqualTo("ㄴ");
        assertThat(first.lpr()).isEqualTo(-5.2);
        assertThat(first.syllable()).isEqualTo(1);
        assertThat(first.startMs()).isEqualTo(120);
        assertThat(first.flagged()).isTrue();
        var second = scored.line().words().get(0).phones().get(1);
        assertThat(second.syllable()).isNull();
        assertThat(second.startMs()).isNull();
        assertThat(scored.line().words().get(1).number()).isTrue();
    }

    @Test
    void wav_는_wav_로_내용_유형이_없으면_mp4_로_보낸다() throws IOException {
        scorer().score(audio(), "audio/wav", "다리");
        assertThat(received.get()).contains("filename=\"line.wav\"", "Content-Type: audio/wav");
        scorer().score(audio(), null, "다리");
        assertThat(received.get()).contains("filename=\"line.m4a\"", "Content-Type: audio/mp4");
    }

    @Test
    void 이백이_아니면_던진다() throws IOException {
        status = 500;
        body = "{\"detail\":\"boom\"}";
        Path file = audio();
        assertThatThrownBy(() -> scorer().score(file, "audio/mp4", "다리"))
                .isInstanceOf(IllegalStateException.class).hasMessageContaining("500");
    }

    @Test
    void 연결하지_못하면_던진다() throws IOException {
        int closed;
        try (ServerSocket socket = new ServerSocket(0)) {
            closed = socket.getLocalPort();
        }
        Path file = audio();
        HttpPronunciationScorer unreachable = new HttpPronunciationScorer("http://127.0.0.1:" + closed, new ObjectMapper());
        assertThatThrownBy(() -> unreachable.score(file, "audio/mp4", "다리"))
                .isInstanceOf(IllegalStateException.class).hasMessageContaining("pronunciation scorer failed");
    }

    @Test
    void 녹음_파일이_없으면_던진다() {
        Path missing = dir.resolve("missing.m4a");
        assertThatThrownBy(() -> scorer().score(missing, "audio/mp4", "다리"))
                .isInstanceOf(IllegalStateException.class).hasCauseInstanceOf(IOException.class);
    }

    @Test
    void 끊긴_스레드면_인터럽트를_되살리고_던진다() throws IOException {
        Path file = audio();
        Thread.currentThread().interrupt();
        try {
            assertThatThrownBy(() -> scorer().score(file, "audio/mp4", "다리")).isInstanceOf(IllegalStateException.class);
        } finally {
            Thread.interrupted();
        }
    }
}
