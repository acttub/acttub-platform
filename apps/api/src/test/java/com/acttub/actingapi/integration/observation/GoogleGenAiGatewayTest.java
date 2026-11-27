package com.acttub.actingapi.integration.observation;

import static org.assertj.core.api.Assertions.assertThat;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.net.InetSocketAddress;
import java.util.concurrent.atomic.AtomicReference;
import com.google.genai.Client;
import com.google.genai.types.HttpOptions;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class GoogleGenAiGatewayTest {
    @TempDir Path directory;

    @Test void explicitMimeMatchesUploadHeaderAndMetadata() throws Exception {
        var header = new AtomicReference<String>();
        var metadata = new AtomicReference<String>();
        var payload = new AtomicReference<byte[]>();
        var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        String base = "http://127.0.0.1:" + server.getAddress().getPort();
        server.createContext("/", exchange -> {
            byte[] request = exchange.getRequestBody().readAllBytes();
            String body;
            if (exchange.getRequestURI().getPath().equals("/bytes")) {
                payload.set(request);
                exchange.getResponseHeaders().add("X-Goog-Upload-Status", "final");
                body = "{\"file\":{\"name\":\"files/test\",\"mimeType\":\"audio/wav\",\"uri\":\"https://files.test/test\",\"state\":\"ACTIVE\"}}";
            } else {
                header.set(exchange.getRequestHeaders().getFirst("X-Goog-Upload-Header-Content-Type"));
                metadata.set(new String(request, StandardCharsets.UTF_8));
                exchange.getResponseHeaders().add("X-Goog-Upload-URL", base + "/bytes");
                body = "{}";
            }
            byte[] response = body.getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, response.length);
            exchange.getResponseBody().write(response);
            exchange.close();
        });
        server.start();
        // A conflicting extension makes OS MIME detection differ on every platform.
        Path audio = Files.write(directory.resolve("take.txt"), new byte[]{1, 2, 3, 4});
        try (var client = Client.builder().apiKey("test-key")
                .httpOptions(HttpOptions.builder().baseUrl(base).build()).build()) {
            var result = new GoogleGenAiGateway(client).upload(audio, "audio/wav");
            assertThat(header.get()).isEqualTo("audio/wav");
            assertThat(metadata.get()).contains("audio/wav");
            assertThat(payload.get()).containsExactly(1, 2, 3, 4);
            assertThat(result.mimeType()).isEqualTo("audio/wav");
        } finally {
            server.stop(0);
        }
    }

    /** SDK 는 8MB 조각이 덜 채워지면 마지막 조각으로 본다. 64KB 씩 읽어도 조각을 다 채워 파일 전체가 올라가야 한다(SOMA-1179). */
    @Test void largeFileGoesUpInFullSdkChunks() throws Exception {
        int sdkChunk = 8 * 1024 * 1024; // google-genai UploadClient.DEFAULT_CHUNK_SIZE(패키지 밖에서 못 읽는다)
        var chunks = new java.util.concurrent.CopyOnWriteArrayList<Integer>();
        var received = new java.io.ByteArrayOutputStream();
        var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        String base = "http://127.0.0.1:" + server.getAddress().getPort();
        server.createContext("/", exchange -> {
            byte[] request = exchange.getRequestBody().readAllBytes();
            String body = "{}";
            if (exchange.getRequestURI().getPath().equals("/bytes")) {
                chunks.add(request.length);
                synchronized (received) {
                    received.writeBytes(request);
                }
                boolean last = exchange.getRequestHeaders().getFirst("X-Goog-Upload-Command").contains("finalize");
                exchange.getResponseHeaders().add("X-Goog-Upload-Status", last ? "final" : "active");
                if (last) {
                    body = "{\"file\":{\"name\":\"files/big\",\"mimeType\":\"video/mp4\",\"uri\":\"https://files.test/big\",\"state\":\"ACTIVE\"}}";
                }
            } else {
                exchange.getResponseHeaders().add("X-Goog-Upload-URL", base + "/bytes");
            }
            byte[] response = body.getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, response.length);
            exchange.getResponseBody().write(response);
            exchange.close();
        });
        server.start();
        byte[] content = new byte[sdkChunk + 3];
        new java.util.Random(7).nextBytes(content);
        Path video = Files.write(directory.resolve("take.mp4"), content);
        try (var client = Client.builder().apiKey("test-key")
                .httpOptions(HttpOptions.builder().baseUrl(base).build()).build()) {
            new GoogleGenAiGateway(client).upload(video, "video/mp4");
            assertThat(chunks).containsExactly(sdkChunk, 3);
            assertThat(received.toByteArray()).isEqualTo(content);
        } finally {
            server.stop(0);
        }
    }
}
