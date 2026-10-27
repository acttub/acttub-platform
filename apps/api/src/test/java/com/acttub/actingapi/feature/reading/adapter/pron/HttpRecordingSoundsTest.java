package com.acttub.actingapi.feature.reading.adapter.pron;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.io.OutputStream;
import java.io.UncheckedIOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import com.acttub.actingapi.feature.reading.domain.ReadingVoiceMaterial.Clip;
import com.acttub.actingapi.feature.reading.domain.RecordingSoundCues.Sound;
import com.acttub.actingapi.integration.storage.ObjectStorage;
import com.acttub.actingapi.integration.storage.StoredObjectMetadata;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** 녹음 코치의 소리 재기: 줄 녹음을 내려받아 /measure 로 보내고, 못 잰 줄·실패한 줄은 빼고 돌려준다(SOMA-791). */
class HttpRecordingSoundsTest {
    HttpServer server;
    final List<String> received = new ArrayList<>();
    final List<Path> downloaded = new ArrayList<>();

    @BeforeEach
    void start() throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/measure", exchange -> {
            String request = new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
            received.add(request);
            String body;
            int status = 200;
            if (request.contains("BROKEN")) {
                status = 500;
                body = "{}";
            } else if (request.contains("SILENT")) {
                body = "{\"measured\":false}";
            } else {
                body = "{\"measured\":true,\"loud_db\":-17.2,\"rate\":5.5,\"max_pause_ms\":300,\"end_semitones\":null,"
                        + "\"end_loud_db\":-1.0,\"speech_ms\":2100}";
            }
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

    private ObjectStorage storage() {
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
                    Files.writeString(destination, objectKey.toUpperCase() + "-AUDIO");
                } catch (IOException failure) {
                    throw new UncheckedIOException(failure);
                }
                downloaded.add(destination);
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

    private static Clip clip(int n, String key) {
        return new Clip(n, "녹음 " + n, UUID.randomUUID(), key, "audio/mp4", "대사 " + n);
    }

    @Test
    void 잰_줄만_돌려주고_임시_파일은_지운다() {
        ObjectStorage storage = storage();
        HttpRecordingSounds sounds = new HttpRecordingSounds(
                "http://127.0.0.1:" + server.getAddress().getPort() + "//", () -> storage, new ObjectMapper());

        Map<Integer, Sound> measured = sounds.measure(List.of(clip(1, "ok"), clip(2, "silent"), clip(3, "broken")));

        assertThat(measured).containsOnlyKeys(1);
        Sound sound = measured.get(1);
        assertThat(sound.loudDb()).isEqualTo(-17.2);
        assertThat(sound.rate()).isEqualTo(5.5);
        assertThat(sound.endSemitones()).isNull();
        assertThat(sound.speechMs()).isEqualTo(2100);
        assertThat(received.getFirst()).contains("name=\"audio\"; filename=\"line.m4a\"", "OK-AUDIO", "name=\"text\"", "대사 1");
        assertThat(downloaded).hasSize(3).allSatisfy(path -> assertThat(Files.exists(path)).isFalse());
    }

    @Test
    void 주소_끝의_빗금은_떼어_낸다() {
        assertThat(HttpRecordingSounds.withoutTrailingSlash("http://pron:8000///")).isEqualTo("http://pron:8000");
        assertThat(HttpRecordingSounds.withoutTrailingSlash("http://pron:8000")).isEqualTo("http://pron:8000");
    }
}
