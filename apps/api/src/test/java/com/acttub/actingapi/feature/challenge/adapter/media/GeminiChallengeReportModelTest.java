package com.acttub.actingapi.feature.challenge.adapter.media;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import com.acttub.actingapi.feature.challenge.app.AiReportRepository.Video;
import com.acttub.actingapi.feature.challenge.app.ChallengeReportModel.Labeled;
import com.acttub.actingapi.integration.storage.ObjectStorage;
import com.acttub.actingapi.integration.storage.StoredObjectMetadata;
import com.acttub.actingapi.support.RecordingFailureReporter;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.google.genai.Client;
import com.google.genai.types.HttpOptions;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.beans.factory.ObjectProvider;

/** 챌린지 AI 리포트가 내 영상과 표본을 라벨과 함께 Gemini 에 한 번에 보이고, 올린 파일·임시 파일을 지우는지. */
class GeminiChallengeReportModelTest {
    @TempDir Path directory;
    final ObjectMapper mapper = new ObjectMapper();
    final ObjectStorage storage = mock(ObjectStorage.class);
    final RecordingFailureReporter failures = new RecordingFailureReporter();
    final List<String> fileStates = Collections.synchronizedList(new ArrayList<>());
    final List<String> deleted = Collections.synchronizedList(new ArrayList<>());
    final List<Path> downloaded = Collections.synchronizedList(new ArrayList<>());
    final AtomicInteger uploads = new AtomicInteger();
    volatile JsonNode compareRequest;
    volatile boolean deleteFails;
    HttpServer server;
    Client client;

    @BeforeEach void start() throws Exception {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> {
            String method = exchange.getRequestMethod();
            String path = exchange.getRequestURI().getPath();
            byte[] request = exchange.getRequestBody().readAllBytes();
            int status = 200;
            String body = "{}";
            if (path.equals("/bytes")) {
                int n = uploads.incrementAndGet();
                exchange.getResponseHeaders().add("X-Goog-Upload-Status", "final");
                body = "{\"file\":{\"name\":\"files/v" + n + "\",\"mimeType\":\"video/mp4\",\"uri\":\"https://files.test/v" + n
                        + "\",\"state\":\"PROCESSING\"}}";
            } else if (method.equals("POST") && path.contains(":generateContent")) {
                compareRequest = mapper.readTree(request);
                body = "{\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"  {\\\"report\\\":\\\"비교\\\"}  \"}],\"role\":\"model\"},\"finishReason\":\"STOP\"}]}";
            } else if (method.equals("GET") && path.contains("/files/")) {
                String state = fileStates.isEmpty() ? "ACTIVE" : fileStates.remove(0);
                body = "{\"name\":\"files/" + path.substring(path.lastIndexOf('/') + 1) + "\",\"state\":\"" + state + "\"}";
            } else if (method.equals("DELETE")) {
                deleted.add(path.substring(path.lastIndexOf('/') + 1));
                if (deleteFails) { status = 400; body = "{\"error\":{\"code\":400,\"message\":\"delete failed\"}}"; }
            } else {
                exchange.getResponseHeaders().add("X-Goog-Upload-URL",
                        "http://127.0.0.1:" + server.getAddress().getPort() + "/bytes");
            }
            byte[] response = body.getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(status, response.length);
            exchange.getResponseBody().write(response);
            exchange.close();
        });
        server.start();
        client = Client.builder().apiKey("not-a-real-key").httpOptions(HttpOptions.builder()
                .baseUrl("http://127.0.0.1:" + server.getAddress().getPort()).build()).build();
    }

    @AfterEach void stop() {
        client.close();
        server.stop(0);
    }

    GeminiChallengeReportModel model(ObjectStorage objects, Client gemini) {
        return new GeminiChallengeReportModel(provider(objects), provider(gemini), "gemini-3-flash-preview", failures);
    }

    @SuppressWarnings("unchecked")
    static <T> ObjectProvider<T> provider(T value) {
        ObjectProvider<T> provider = mock(ObjectProvider.class);
        when(provider.getIfAvailable()).thenReturn(value);
        return provider;
    }

    void storageServesARealClip() throws Exception {
        requireNativeMediaToolsOrSkip();
        Path clip = toneClip(directory.resolve("clip.mp4"));
        when(storage.downloadToPath(anyString(), any())).thenAnswer(call -> {
            Path destination = call.getArgument(1);
            downloaded.add(destination);
            Files.copy(clip, destination, java.nio.file.StandardCopyOption.REPLACE_EXISTING);
            return new StoredObjectMetadata(Files.size(clip), "video/mp4", "\"etag\"");
        });
    }

    @Test void missingStorageOrModelFailsSoTheWorkerDecidesRetry() {
        assertThatThrownBy(() -> model(null, client).generate(new Video("mine.mp4", "video/mp4", 1000), List.of(), "지침"))
                .isInstanceOf(IllegalStateException.class).hasMessage("challenge report model is unavailable");
        assertThatThrownBy(() -> model(storage, null).generate(new Video("mine.mp4", "video/mp4", 1000), List.of(), "지침"))
                .isInstanceOf(IllegalStateException.class).hasMessage("challenge report model is unavailable");
        assertThat(uploads.get()).isZero();
    }

    @Test void showsMyVideoFirstThenLabeledSamplesAndCleansUpEverything() throws Exception {
        storageServesARealClip();
        fileStates.add("PROCESSING");
        var output = model(storage, client).generate(new Video("mine.mp4", "video/mp4", 1000),
                List.of(new Labeled("표본 1", new Video("sample-1.mp4", "video/mp4", 2000))), "비교 지침");

        assertThat(output.text()).isEqualTo("{\"report\":\"비교\"}");
        assertThat(output.model()).isEqualTo("gemini-3-flash-preview");
        JsonNode parts = compareRequest.path("contents").get(0).path("parts");
        assertThat(parts).hasSize(4);
        assertThat(parts.get(0).path("text").asText()).isEqualTo("내 영상");
        assertThat(parts.get(1).path("fileData").path("fileUri").asText()).isEqualTo("https://files.test/v1");
        assertThat(parts.get(2).path("text").asText()).isEqualTo("표본 1");
        assertThat(parts.get(3).path("fileData").path("fileUri").asText()).isEqualTo("https://files.test/v2");
        assertThat(compareRequest.path("systemInstruction").path("parts").get(0).path("text").asText()).isEqualTo("비교 지침");
        assertThat(deleted).containsExactlyInAnyOrder("v1", "v2");
        assertThat(downloaded).hasSize(2).allSatisfy(path -> assertThat(path).doesNotExist());
        assertThat(failures.reports()).isEmpty();
    }

    @Test void failedProcessingStillDeletesUploadedFilesAndTemporaryCopies() throws Exception {
        storageServesARealClip();
        fileStates.add("FAILED");
        assertThatThrownBy(() -> model(storage, client).generate(new Video("mine.mp4", "video/mp4", 1000), List.of(), "지침"))
                .isInstanceOf(IllegalStateException.class).hasMessage("video processing failed");
        assertThat(compareRequest).isNull();
        assertThat(deleted).containsExactly("v1");
        assertThat(downloaded).hasSize(1).allSatisfy(path -> assertThat(path).doesNotExist());
    }

    @Test void aFailedRemoteDeleteIsReportedWithoutLosingTheReport() throws Exception {
        storageServesARealClip();
        deleteFails = true;
        var output = model(storage, client).generate(new Video("mine.mp4", "video/mp4", 1000), List.of(), "지침");
        assertThat(output.text()).isEqualTo("{\"report\":\"비교\"}");
        assertThat(failures.contexts()).containsExactly("GeminiChallengeReportModel.delete");
    }

    private static void requireNativeMediaToolsOrSkip() {
        boolean available = commandSucceeds("ffmpeg", "-version") && commandSucceeds("ffprobe", "-version");
        if ("true".equals(System.getenv("CI")) && !available) {
            throw new IllegalStateException("ffmpeg/ffprobe missing in CI; the API job must install them");
        }
        Assumptions.assumeTrue(available, "ffmpeg/ffprobe not available locally");
    }

    private static boolean commandSucceeds(String... command) {
        try {
            Process process = new ProcessBuilder(command).redirectOutput(ProcessBuilder.Redirect.DISCARD)
                    .redirectError(ProcessBuilder.Redirect.DISCARD).start();
            return process.waitFor(15, TimeUnit.SECONDS) && process.exitValue() == 0;
        } catch (Exception failure) {
            return false;
        }
    }

    private static Path toneClip(Path target) throws Exception {
        Process process = new ProcessBuilder("ffmpeg", "-y", "-f", "lavfi", "-i", "color=c=black:s=16x16:d=0.2",
                "-f", "lavfi", "-i", "sine=frequency=1000:duration=0.2", "-c:v", "libx264", "-pix_fmt", "yuv420p",
                "-c:a", "aac", "-shortest", target.toString())
                .redirectOutput(ProcessBuilder.Redirect.DISCARD).redirectError(ProcessBuilder.Redirect.DISCARD).start();
        if (!process.waitFor(15, TimeUnit.SECONDS) || process.exitValue() != 0) {
            throw new IllegalStateException("failed to synthesize local test clip with ffmpeg");
        }
        return target;
    }
}
