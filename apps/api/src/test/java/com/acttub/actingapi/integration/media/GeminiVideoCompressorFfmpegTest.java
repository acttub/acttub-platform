package com.acttub.actingapi.integration.media;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Random;

import com.acttub.actingapi.support.RecordingFailureReporter;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** 운영 조립(PATH 의 ffmpeg 를 찾아 실제로 실행)으로 압축과 실패 폴백을 본다. ffmpeg 가 없으면 건너뛴다. */
class GeminiVideoCompressorFfmpegTest {
    @TempDir
    Path directory;

    private final RecordingFailureReporter reporter = new RecordingFailureReporter();
    private final GeminiVideoCompressor compressor = new GeminiVideoCompressor(reporter);

    @Test
    void largeVideoIsReencodedIntoASmallerSibling() throws Exception {
        assumeTrue(ffmpegAvailable(), "ffmpeg 가 없다");
        Path source = directory.resolve("take.mp4");
        int exit = new ProcessBuilder("ffmpeg", "-y", "-f", "lavfi", "-i", "testsrc=size=640x360:rate=30:duration=2,noise=alls=60:allf=t",
                "-f", "lavfi", "-i", "anoisesrc=duration=2", "-c:v", "libx264", "-preset", "ultrafast", "-qp", "0",
                "-c:a", "aac", "-shortest", source.toString())
                .redirectErrorStream(true).redirectOutput(ProcessBuilder.Redirect.DISCARD).start().waitFor();
        assumeTrue(exit == 0 && Files.size(source) > GeminiVideoCompressor.MIN_BYTES, "15MB 넘는 시험 영상을 만들지 못했다");

        Path compressed = compressor.compress(source);

        assertThat(compressed).isEqualTo(directory.resolve("take.gemini.mp4"));
        assertThat(Files.size(compressed)).isPositive().isLessThan(Files.size(source));
        assertThat(reporter.reports()).isEmpty();
    }

    @Test
    void largeFileFfmpegCannotReadFallsBackToTheOriginalAndIsReported() throws Exception {
        assumeTrue(ffmpegAvailable(), "ffmpeg 가 없다");
        Path source = directory.resolve("take");
        byte[] noise = new byte[(int) GeminiVideoCompressor.MIN_BYTES + 1024];
        new Random(7).nextBytes(noise);
        Files.write(source, noise);

        Path result = compressor.compress(source);

        assertThat(result).isEqualTo(source);
        assertThat(directory.resolve("take.gemini.mp4")).doesNotExist();
        assertThat(reporter.reports()).singleElement().satisfies(report -> {
            assertThat(report.failure()).isInstanceOf(IOException.class).hasMessageStartingWith("ffmpeg exited with status ");
            assertThat(report.context()).isEqualTo("GeminiVideoCompressor.compress");
        });
    }

    @Test
    void missingSourceIsAnIoFailure() {
        assertThatThrownBy(() -> compressor.compress(directory.resolve("gone.mp4")))
                .isInstanceOf(UncheckedIOException.class);
    }

    private static boolean ffmpegAvailable() {
        String path = System.getenv("PATH");
        return path != null && List.of(path.split(java.io.File.pathSeparator)).stream()
                .map(directory -> Path.of(directory, "ffmpeg"))
                .anyMatch(candidate -> Files.isRegularFile(candidate) && Files.isExecutable(candidate));
    }
}
