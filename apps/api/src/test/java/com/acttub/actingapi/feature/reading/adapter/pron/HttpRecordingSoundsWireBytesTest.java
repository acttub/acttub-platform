package com.acttub.actingapi.feature.reading.adapter.pron;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.reading.domain.ReadingVoiceMaterial.Clip;
import com.acttub.actingapi.integration.storage.ObjectStorage;
import com.acttub.actingapi.integration.storage.StoredObjectMetadata;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * 채점 서비스 {@code POST /measure} 로 나가는 multipart 본문을 바이트 그대로 고정한다. 경계 문자열만 매번 새로 만들므로,
 * 경계는 모양만 보고 그 밖의 바이트는 모두 같아야 한다. 본문에 JSON 은 없다.
 */
class HttpRecordingSoundsWireBytesTest {
    /** 한글, 따옴표, 빗금, 역빗금, 줄바꿈, 탭, 제어 문자, 이모지. */
    private static final String TRICKY = "따옴표\"와 빗금/와 역빗금\\ 줄\n탭\t제어\u001f 이모지😀";
    /** 널 바이트, 0xFF, CR LF, 대시 두 개가 든 가짜 소리 파일. */
    private static final byte[] AUDIO = {0x00, (byte) 0xFF, '\r', '\n', '-', '-', 'R', 'I', 'F', 'F'};

    private final List<byte[]> bodies = new ArrayList<>();
    private final List<String> contentTypes = new ArrayList<>();
    private HttpServer server;

    @BeforeEach
    void start() throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/measure", exchange -> {
            contentTypes.add(exchange.getRequestHeaders().getFirst("Content-Type"));
            bodies.add(exchange.getRequestBody().readAllBytes());
            byte[] out = "{\"measured\":false}".getBytes(StandardCharsets.UTF_8);
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

    private static ObjectStorage storage() {
        return new ObjectStorage() {
            @Override
            public String presignUpload(String objectKey, String mimeType, long sizeBytes, int expiresInSeconds) {
                throw new UnsupportedOperationException();
            }

            @Override
            public String presignPlayback(String objectKey, int expiresInSeconds) {
                throw new UnsupportedOperationException();
            }

            @Override
            public StoredObjectMetadata head(String objectKey) {
                throw new UnsupportedOperationException();
            }

            @Override
            public StoredObjectMetadata downloadToPath(String objectKey, Path destination) {
                try {
                    Files.write(destination, AUDIO);
                } catch (IOException failure) {
                    throw new UncheckedIOException(failure);
                }
                return null;
            }

            @Override
            public void upload(String objectKey, String mimeType, Path source) {
                throw new UnsupportedOperationException();
            }

            @Override
            public void delete(String objectKey) {
                throw new UnsupportedOperationException();
            }
        };
    }

    private HttpRecordingSounds sounds() {
        ObjectStorage storage = storage();
        return new HttpRecordingSounds("http://127.0.0.1:" + server.getAddress().getPort(), () -> storage,
                new ObjectMapper());
    }

    private String boundary(int index) {
        String contentType = contentTypes.get(index);
        assertThat(contentType).matches(
                "multipart/form-data; boundary=measure-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}");
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
    @DisplayName("줄 녹음마다 소리 파트, 글 파트 순서로 보내고 형식을 모르면 audio/mp4, 글이 없으면 빈 글을 싣는다")
    void clipBodies() {
        sounds().measure(List.of(
                new Clip(1, "녹음 1", UUID.fromString("00000000-0000-0000-0000-000000000001"), "clips/1", "audio/wav", TRICKY),
                new Clip(2, "녹음 2", UUID.fromString("00000000-0000-0000-0000-000000000002"), "clips/2", null, null)));

        assertThat(bodies).hasSize(2);
        String first = boundary(0);
        assertThat(bodies.get(0)).isEqualTo(join(
                "--" + first + "\r\nContent-Disposition: form-data; name=\"audio\"; filename=\"line.wav\"\r\n"
                        + "Content-Type: audio/wav\r\n\r\n",
                AUDIO,
                "\r\n--" + first + "\r\nContent-Disposition: form-data; name=\"text\"\r\n\r\n" + TRICKY
                        + "\r\n--" + first + "--\r\n"));
        String second = boundary(1);
        assertThat(bodies.get(1)).isEqualTo(join(
                "--" + second + "\r\nContent-Disposition: form-data; name=\"audio\"; filename=\"line.m4a\"\r\n"
                        + "Content-Type: audio/mp4\r\n\r\n",
                AUDIO,
                "\r\n--" + second + "\r\nContent-Disposition: form-data; name=\"text\"\r\n\r\n\r\n--" + second + "--\r\n"));
    }
}
