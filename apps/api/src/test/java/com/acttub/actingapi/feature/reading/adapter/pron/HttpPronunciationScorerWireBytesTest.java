package com.acttub.actingapi.feature.reading.adapter.pron;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

import tools.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/**
 * 채점 서비스 {@code POST /score} 로 나가는 multipart 본문을 바이트 그대로 고정한다. 경계 문자열만 매번 새로 만들므로,
 * 경계는 모양만 보고 그 밖의 바이트는 모두 같아야 한다. 본문에 JSON 은 없다.
 */
class HttpPronunciationScorerWireBytesTest {
    /** 한글, 따옴표, 빗금, 역빗금, 줄바꿈, 탭, 제어 문자, 이모지. */
    private static final String TRICKY = "따옴표\"와 빗금/와 역빗금\\ 줄\n탭\t제어\u001f 이모지😀";
    /** 널 바이트, 0xFF, CR LF, 대시 두 개가 든 가짜 소리 파일. */
    private static final byte[] AUDIO = {0x00, (byte) 0xFF, '\r', '\n', '-', '-', 'R', 'I', 'F', 'F'};

    @TempDir
    Path directory;

    private final List<byte[]> bodies = new ArrayList<>();
    private final List<String> contentTypes = new ArrayList<>();
    private HttpServer server;

    @BeforeEach
    void start() throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/score", exchange -> {
            contentTypes.add(exchange.getRequestHeaders().getFirst("Content-Type"));
            bodies.add(exchange.getRequestBody().readAllBytes());
            byte[] out = "{}".getBytes(StandardCharsets.UTF_8);
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

    private HttpPronunciationScorer scorer() {
        return new HttpPronunciationScorer("http://127.0.0.1:" + server.getAddress().getPort() + "/", new ObjectMapper());
    }

    private String boundary() {
        String contentType = contentTypes.getFirst();
        assertThat(contentType).matches("multipart/form-data; boundary=pron-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}");
        return contentType.substring("multipart/form-data; boundary=".length());
    }

    private static byte[] join(String head, byte[] audio, String tail) {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        out.writeBytes(head.getBytes(StandardCharsets.UTF_8));
        out.writeBytes(audio);
        out.writeBytes(tail.getBytes(StandardCharsets.UTF_8));
        return out.toByteArray();
    }

    @Test
    @DisplayName("wav 녹음은 소리 파트, 글 파트 순서로 보내고 소리 바이트와 글을 그대로 싣는다")
    void wavBody() throws IOException {
        Path audio = Files.write(directory.resolve("take.wav"), AUDIO);

        scorer().score(audio, "audio/wav", TRICKY);

        String b = boundary();
        assertThat(bodies.getFirst()).isEqualTo(join(
                "--" + b + "\r\nContent-Disposition: form-data; name=\"audio\"; filename=\"line.wav\"\r\n"
                        + "Content-Type: audio/wav\r\n\r\n",
                AUDIO,
                "\r\n--" + b + "\r\nContent-Disposition: form-data; name=\"text\"\r\n\r\n" + TRICKY + "\r\n--" + b + "--\r\n"));
    }

    @Test
    @DisplayName("형식을 모르는 녹음은 audio/mp4 와 m4a 이름으로 보낸다")
    void unknownTypeBody() throws IOException {
        Path audio = Files.write(directory.resolve("take.m4a"), AUDIO);

        scorer().score(audio, null, "대사");

        String b = boundary();
        assertThat(bodies.getFirst()).isEqualTo(join(
                "--" + b + "\r\nContent-Disposition: form-data; name=\"audio\"; filename=\"line.m4a\"\r\n"
                        + "Content-Type: audio/mp4\r\n\r\n",
                AUDIO,
                "\r\n--" + b + "\r\nContent-Disposition: form-data; name=\"text\"\r\n\r\n대사\r\n--" + b + "--\r\n"));
    }
}
