package com.acttub.actingapi.integration.media;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeoutException;

import com.acttub.actingapi.platform.observability.FailureKind;
import com.acttub.actingapi.support.RecordingFailureReporter;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class GeminiVideoCompressorTest {

    @TempDir
    Path directory;

    @Test
    void fileAtOrBelowFifteenMegabytesReturnsTheOriginalWithoutLookingForFfmpeg()
            throws Exception {
        assertThat(GeminiVideoCompressor.MIN_BYTES).isEqualTo(15L * 1024 * 1024);
        Path source = source("small.mp4", 4);
        GeminiVideoCompressor compressor = new GeminiVideoCompressor(
                4, Duration.ofSeconds(600),
                command -> {
                    throw new AssertionError("ffmpeg lookup must be skipped");
                },
                (command, timeout) -> {
                    throw new AssertionError("ffmpeg must not run");
                },
                new RecordingFailureReporter());

        assertThat(compressor.compress(source)).isEqualTo(source);
    }

    @Test
    void missingFfmpegReturnsTheOriginal() throws Exception {
        Path source = source("missing.mp4", 5);
        GeminiVideoCompressor compressor = compressor(command -> null, noRun());

        assertThat(compressor.compress(source)).isEqualTo(source);
    }

    @Test
    void executionFailureOrTimeoutDeletesOutputAndReturnsTheOriginal() throws Exception {
        for (Exception failure : List.of(
                new IOException("exit 1"),
                new TimeoutException("timed out"))) {
            RecordingFailureReporter reporter = new RecordingFailureReporter();
            Path source = source("failure-" + failure.getClass().getSimpleName() + ".mov", 5);
            Path output = outputFor(source);
            GeminiVideoCompressor compressor = compressor(
                    command -> "/usr/bin/ffmpeg",
                    (command, timeout) -> {
                        Files.write(output, new byte[] {1});
                        throw failure;
                    },
                    reporter);

            assertThat(compressor.compress(source)).isEqualTo(source);
            assertThat(output).doesNotExist();
            assertThat(reporter.reports()).singleElement().satisfies(report -> {
                assertThat(report.failure()).isSameAs(failure);
                assertThat(report.kind()).isEqualTo(FailureKind.UNEXPECTED);
                assertThat(report.context()).isEqualTo("GeminiVideoCompressor.compress");
            });
        }
    }

    @Test
    void absentOrEmptyOutputReturnsTheOriginal() throws Exception {
        Path absentSource = source("absent.mp4", 5);
        GeminiVideoCompressor absent = compressor(
                command -> "/usr/bin/ffmpeg", (command, timeout) -> { });
        assertThat(absent.compress(absentSource)).isEqualTo(absentSource);

        Path emptySource = source("empty.mp4", 5);
        Path emptyOutput = outputFor(emptySource);
        GeminiVideoCompressor empty = compressor(command -> "/usr/bin/ffmpeg",
                (command, timeout) -> Files.createFile(emptyOutput));
        assertThat(empty.compress(emptySource)).isEqualTo(emptySource);
        assertThat(emptyOutput).doesNotExist();
    }

    @Test
    void outputThatIsNotSmallerReturnsTheOriginal() throws Exception {
        Path source = source("larger.mp4", 5);
        Path output = outputFor(source);
        GeminiVideoCompressor compressor = compressor(command -> "/usr/bin/ffmpeg",
                (command, timeout) -> Files.write(output, new byte[] {1, 2, 3, 4, 5}));

        assertThat(compressor.compress(source)).isEqualTo(source);
        assertThat(output).doesNotExist();
    }

    @Test
    void successfulCompressionUsesTheExactActingSummaryCommand() throws Exception {
        assertThat(GeminiVideoCompressor.TIMEOUT).isEqualTo(Duration.ofSeconds(600));
        Path source = source("take.video", 5);
        Path output = outputFor(source);
        ArrayList<String> captured = new ArrayList<>();
        Duration[] capturedTimeout = new Duration[1];
        GeminiVideoCompressor compressor = compressor(command -> "/opt/bin/ffmpeg",
                (command, timeout) -> {
                    captured.addAll(command);
                    capturedTimeout[0] = timeout;
                    Files.write(output, new byte[] {1});
                });

        assertThat(compressor.compress(source)).isEqualTo(output);
        assertThat(capturedTimeout[0]).isEqualTo(Duration.ofSeconds(600));
        assertThat(captured).containsExactly(
                "/opt/bin/ffmpeg",
                "-y",
                "-threads", "1",
                "-i", source.toString(),
                "-vf", "scale=w=768:h=768:force_original_aspect_ratio=decrease:force_divisible_by=2",
                "-r", "10",
                "-c:v", "libx264",
                "-preset", "ultrafast",
                "-crf", "28",
                "-pix_fmt", "yuv420p",
                "-c:a", "aac",
                "-b:a", "64k",
                "-ac", "1",
                "-movflags", "+faststart",
                "-threads", "1",
                output.toString());
    }

    private GeminiVideoCompressor compressor(
            GeminiVideoCompressor.ExecutableFinder finder,
            GeminiVideoCompressor.CommandRunner runner) {
        return compressor(finder, runner, new RecordingFailureReporter());
    }

    private GeminiVideoCompressor compressor(
            GeminiVideoCompressor.ExecutableFinder finder,
            GeminiVideoCompressor.CommandRunner runner,
            RecordingFailureReporter reporter) {
        return new GeminiVideoCompressor(4, Duration.ofSeconds(600), finder, runner, reporter);
    }

    private GeminiVideoCompressor.CommandRunner noRun() {
        return (command, timeout) -> {
            throw new AssertionError("ffmpeg must not run");
        };
    }

    private Path source(String name, int bytes) throws IOException {
        byte[] content = new byte[bytes];
        java.util.Arrays.fill(content, (byte) 7);
        return Files.write(directory.resolve(name), content);
    }

    private static Path outputFor(Path source) {
        String name = source.getFileName().toString();
        int suffix = name.lastIndexOf('.');
        String stem = suffix > 0 ? name.substring(0, suffix) : name;
        return source.resolveSibling(stem + ".gemini.mp4");
    }
}
