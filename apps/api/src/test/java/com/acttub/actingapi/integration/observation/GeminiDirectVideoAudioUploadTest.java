package com.acttub.actingapi.integration.observation;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import com.google.genai.Client;
import com.google.genai.types.HttpOptions;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/**
 * The original file's audio-track probe must land in the resulting Video as a fact the model
 * cannot guess around, and a failed probe must never fall back to a false "no audio" signal.
 */
class GeminiDirectVideoAudioUploadTest {
    @TempDir Path directory;

    @Test void audibleInputSkipsFrameInspectionAndCannotBeEmpty() throws Exception {
        var externalUploadCalls = new AtomicInteger();
        var frameCalls = new AtomicInteger();
        var server = resumableUploadServer(externalUploadCalls, "ACTIVE");
        try (var client = fakeClient(server)) {
            var model = new GeminiDirectVideoModel(client, "gemini-3-flash-preview", path -> true, path -> {
                frameCalls.incrementAndGet();
                throw new IllegalStateException("must not inspect audible input frames");
            });
            var facts = model.inspect(directory.resolve("voice.mp4"));
            assertThat(facts.hasAudioTrack()).isTrue();
            assertThat(facts.fullBlack()).isNull();
            assertThat(facts.emptyInput()).isFalse();
            assertThat(frameCalls.get()).isZero();
            assertThat(externalUploadCalls.get()).isZero();
        } finally { server.stop(0); }
    }

    @Test void absentAudioAndEveryFrameBlackRejectsEvenAnAccidentalUpload() throws Exception {
        var externalUploadCalls = new AtomicInteger();
        var server = resumableUploadServer(externalUploadCalls, "ACTIVE");
        try (var client = fakeClient(server)) {
            var model = new GeminiDirectVideoModel(client, "gemini-3-flash-preview", path -> false, path -> true);
            Path source = directory.resolve("empty.mp4");
            var facts = model.inspect(source);
            assertThat(facts.emptyInput()).isTrue();
            assertThatThrownBy(() -> model.upload(source, "video/mp4", facts))
                    .isInstanceOf(IllegalArgumentException.class).hasMessageContaining("empty input");
            assertThat(externalUploadCalls.get()).isZero();
        } finally { server.stop(0); }
    }

    @Test void visualInputReusesMeasuredAudioAbsenceWithoutProbingTwice() throws Exception {
        var externalUploadCalls = new AtomicInteger();
        var audioCalls = new AtomicInteger();
        var server = resumableUploadServer(externalUploadCalls, "ACTIVE");
        try (var client = fakeClient(server)) {
            var model = new GeminiDirectVideoModel(client, "gemini-3-flash-preview", path -> {
                audioCalls.incrementAndGet();
                return false;
            }, path -> false);
            Path source = Files.write(directory.resolve("silent-acting.mp4"), new byte[]{1, 2, 3});
            var facts = model.inspect(source);
            assertThat(facts.emptyInput()).isFalse();
            assertThat(model.upload(source, "video/mp4", facts).hasAudioTrack()).isFalse();
            assertThat(audioCalls.get()).isEqualTo(1);
            assertThat(externalUploadCalls.get()).isEqualTo(1);
        } finally { server.stop(0); }
    }

    @Test void failedFrameInspectionDoesNotBecomeAnEmptyInputFact() throws Exception {
        var externalUploadCalls = new AtomicInteger();
        var server = resumableUploadServer(externalUploadCalls, "ACTIVE");
        try (var client = fakeClient(server)) {
            var model = new GeminiDirectVideoModel(client, "gemini-3-flash-preview", path -> false, path -> {
                throw new IllegalStateException("frame decoder failed");
            });
            assertThatThrownBy(() -> model.inspect(directory.resolve("broken.mp4")))
                    .isInstanceOf(IllegalStateException.class).hasMessageContaining("frame decoder failed");
            assertThat(externalUploadCalls.get()).isZero();
        } finally { server.stop(0); }
    }

    @Test void failedAudioInspectionDoesNotProceedToFrameInspection() throws Exception {
        var externalUploadCalls = new AtomicInteger();
        var frameCalls = new AtomicInteger();
        var server = resumableUploadServer(externalUploadCalls, "ACTIVE");
        try (var client = fakeClient(server)) {
            var model = new GeminiDirectVideoModel(client, "gemini-3-flash-preview", path -> {
                throw new IllegalStateException("audio probe failed");
            }, path -> { frameCalls.incrementAndGet(); return true; });
            assertThatThrownBy(() -> model.inspect(directory.resolve("broken.mp4")))
                    .isInstanceOf(IllegalStateException.class).hasMessageContaining("audio probe failed");
            assertThat(frameCalls.get()).isZero();
            assertThat(externalUploadCalls.get()).isZero();
        } finally { server.stop(0); }
    }

    @Test void keepsTruePresenceProbeResultOnTheReturnedVideo() throws Exception {
        var externalUploadCalls = new AtomicInteger();
        var server = resumableUploadServer(externalUploadCalls, "ACTIVE");
        try (var client = fakeClient(server)) {
            var model = new GeminiDirectVideoModel(client, "gemini-3-flash-preview", path -> true);
            Path source = Files.write(directory.resolve("take.mp4"), new byte[]{1, 2, 3});
            DirectVideoModel.Video video = model.upload(source, "video/mp4");
            assertThat(video.hasAudioTrack()).isTrue();
            assertThat(externalUploadCalls.get()).isEqualTo(1);
        } finally {
            server.stop(0);
        }
    }

    @Test void keepsFalseAbsenceProbeResultOnTheReturnedVideo() throws Exception {
        var externalUploadCalls = new AtomicInteger();
        var server = resumableUploadServer(externalUploadCalls, "ACTIVE");
        try (var client = fakeClient(server)) {
            var model = new GeminiDirectVideoModel(client, "gemini-3-flash-preview", path -> false);
            Path source = Files.write(directory.resolve("silent.mp4"), new byte[]{1, 2, 3});
            DirectVideoModel.Video video = model.upload(source, "video/mp4");
            assertThat(video.hasAudioTrack()).isFalse();
            assertThat(externalUploadCalls.get()).isEqualTo(1);
        } finally {
            server.stop(0);
        }
    }

    @Test void neverUploadsWhenTheAudioTrackProbeFails() throws Exception {
        var externalUploadCalls = new AtomicInteger();
        var server = resumableUploadServer(externalUploadCalls, "ACTIVE");
        try (var client = fakeClient(server)) {
            var model = new GeminiDirectVideoModel(client, "gemini-3-flash-preview", path -> {
                throw new IllegalStateException("audio track probe failed");
            });
            Path source = Files.write(directory.resolve("unreadable.mp4"), new byte[]{1, 2, 3});
            assertThatThrownBy(() -> model.upload(source, "video/mp4"))
                    .isInstanceOf(IllegalStateException.class)
                    .hasMessageContaining("audio track probe failed");
            assertThat(externalUploadCalls.get()).isZero();
        } finally {
            server.stop(0);
        }
    }

    /**
     * Real ffprobe path (no fake Predicate): generates genuinely silent vs. audible local MP4s
     * with ffmpeg and runs them through the production default constructor's VideoRecordChunks probe.
     * In CI this must run for real, never skip; locally it skips only when the native tools are absent.
     */
    @Test void realFfprobeMarksASyntheticSilentClipAsHavingNoAudioTrack() throws Exception {
        requireNativeMediaToolsOrSkip();
        var externalUploadCalls = new AtomicInteger();
        var server = resumableUploadServer(externalUploadCalls, "ACTIVE");
        try (var client = fakeClient(server)) {
            var model = new GeminiDirectVideoModel(client, "gemini-3-flash-preview");
            Path source = generateLocalClip(directory.resolve("silent-real.mp4"), false);
            DirectVideoModel.Video video = model.upload(source, "video/mp4");
            assertThat(video.hasAudioTrack()).isFalse();
            assertThat(externalUploadCalls.get()).isEqualTo(1);
        } finally {
            server.stop(0);
        }
    }

    @Test void realFfprobeMarksASyntheticToneClipAsHavingAnAudioTrack() throws Exception {
        requireNativeMediaToolsOrSkip();
        var externalUploadCalls = new AtomicInteger();
        var server = resumableUploadServer(externalUploadCalls, "ACTIVE");
        try (var client = fakeClient(server)) {
            var model = new GeminiDirectVideoModel(client, "gemini-3-flash-preview");
            Path source = generateLocalClip(directory.resolve("audible-real.mp4"), true);
            DirectVideoModel.Video video = model.upload(source, "video/mp4");
            assertThat(video.hasAudioTrack()).isTrue();
            assertThat(externalUploadCalls.get()).isEqualTo(1);
        } finally {
            server.stop(0);
        }
    }

    @Test void realFfprobeFailureOnAGarbageFileNeverReachesGoogleUpload() throws Exception {
        requireNativeMediaToolsOrSkip();
        var externalUploadCalls = new AtomicInteger();
        var server = resumableUploadServer(externalUploadCalls, "ACTIVE");
        try (var client = fakeClient(server)) {
            var model = new GeminiDirectVideoModel(client, "gemini-3-flash-preview");
            // Not a real container; ffprobe must exit non-zero against this, not guess an answer.
            Path source = Files.write(directory.resolve("garbage.mp4"),
                    "this is not a video file".getBytes(StandardCharsets.UTF_8));
            assertThatThrownBy(() -> model.upload(source, "video/mp4"))
                    .isInstanceOf(IllegalStateException.class)
                    .hasMessageContaining("audio track probe failed");
            assertThat(externalUploadCalls.get()).isZero();
        } finally {
            server.stop(0);
        }
    }

    /**
     * CI must always exercise the real ffprobe path (the API job guarantees ffmpeg/ffprobe exist).
     * Locally, where those native tools may be missing, skip instead of failing the build.
     */
    private static void requireNativeMediaToolsOrSkip() {
        boolean available = nativeMediaToolsAvailable();
        if ("true".equals(System.getenv("CI"))) {
            // Assumptions.assumeTrue() would report this as SKIPPED, hiding a missing-tool CI
            // misconfiguration. CI must fail outright instead of silently skipping the real probe.
            if (!available) {
                throw new IllegalStateException("ffmpeg/ffprobe missing in CI; the API job must install them");
            }
            return;
        }
        Assumptions.assumeTrue(available, "ffmpeg/ffprobe not available locally; skipping native probe test");
    }

    private static boolean nativeMediaToolsAvailable() {
        return commandSucceeds("ffmpeg", "-version") && commandSucceeds("ffprobe", "-version");
    }

    private static boolean commandSucceeds(String... command) {
        Process process = null;
        try {
            process = new ProcessBuilder(command)
                    .redirectOutput(ProcessBuilder.Redirect.DISCARD)
                    .redirectError(ProcessBuilder.Redirect.DISCARD)
                    .start();
            return process.waitFor(15, TimeUnit.SECONDS) && process.exitValue() == 0;
        } catch (Exception failure) {
            if (failure instanceof InterruptedException) {
                Thread.currentThread().interrupt();
            }
            return false;
        } finally {
            if (process != null && process.isAlive()) {
                process.destroyForcibly();
            }
        }
    }

    /** Generates a tiny, content-free (no faces/no real footage) local clip: 16x16 black, ~0.2s. */
    private static Path generateLocalClip(Path target, boolean withAudio) throws Exception {
        List<String> command = withAudio
                ? List.of("ffmpeg", "-y", "-f", "lavfi", "-i", "color=c=black:s=16x16:d=0.2",
                        "-f", "lavfi", "-i", "sine=frequency=1000:duration=0.2",
                        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest",
                        target.toString())
                : List.of("ffmpeg", "-y", "-f", "lavfi", "-i", "color=c=black:s=16x16:d=0.2",
                        "-c:v", "libx264", "-pix_fmt", "yuv420p", target.toString());
        Process process = null;
        try {
            process = new ProcessBuilder(command)
                    .redirectOutput(ProcessBuilder.Redirect.DISCARD)
                    .redirectError(ProcessBuilder.Redirect.DISCARD)
                    .start();
            if (!process.waitFor(15, TimeUnit.SECONDS) || process.exitValue() != 0) {
                throw new IllegalStateException("failed to synthesize local test clip with ffmpeg");
            }
            return target;
        } finally {
            if (process != null && process.isAlive()) {
                process.destroyForcibly();
            }
        }
    }

    private static Client fakeClient(HttpServer server) {
        String base = "http://127.0.0.1:" + server.getAddress().getPort();
        return Client.builder().apiKey("not-a-real-key")
                .httpOptions(HttpOptions.builder().baseUrl(base).build()).build();
    }

    /** Mimics the SDK's resumable upload: an init POST handing back an upload URL, then the byte POST. */
    private static HttpServer resumableUploadServer(AtomicInteger externalUploadCalls, String fileState) throws Exception {
        var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        String[] base = {null};
        server.createContext("/", exchange -> {
            String path = exchange.getRequestURI().getPath();
            byte[] request = exchange.getRequestBody().readAllBytes();
            String body;
            if (path.equals("/bytes")) {
                externalUploadCalls.incrementAndGet();
                exchange.getResponseHeaders().add("X-Goog-Upload-Status", "final");
                body = "{\"file\":{\"name\":\"files/test\",\"mimeType\":\"video/mp4\","
                        + "\"uri\":\"https://files.test/test\",\"state\":\"" + fileState + "\"}}";
            } else {
                exchange.getResponseHeaders().add("X-Goog-Upload-URL", base[0] + "/bytes");
                body = "{}";
            }
            byte[] response = body.getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, response.length);
            exchange.getResponseBody().write(response);
            exchange.close();
        });
        server.start();
        base[0] = "http://127.0.0.1:" + server.getAddress().getPort();
        return server;
    }
}
