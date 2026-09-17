package com.acttub.actingapi.integration.media;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.List;
import java.util.concurrent.TimeUnit;

/** 원본 영상에서 16kHz 모노 PCM WAV를 추출한다. 반환한 파일은 호출자가 지운다. */
public final class AudioExtractor {
    static final Duration TIMEOUT = Duration.ofSeconds(600);
    private final CommandRunner runner;

    public AudioExtractor() {
        this(AudioExtractor::runCommand);
    }

    AudioExtractor(CommandRunner runner) {
        this.runner = runner;
    }

    public Path extract(Path videoPath) {
        Path output = null;
        try {
            output = Files.createTempFile(videoPath.toAbsolutePath().getParent(),
                    "acttub-speech-", ".wav");
            List<String> command = List.of(
                    "ffmpeg", "-y", "-threads", "1", "-i", videoPath.toString(),
                    "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le",
                    "-threads", "1", output.toString());
            FfmpegLock.run(() -> {
                runner.run(command, TIMEOUT);
                return null;
            });
            if (Files.size(output) == 0) {
                throw new IOException("ffmpeg produced empty audio");
            }
            return output;
        } catch (Exception exception) {
            if (output != null) {
                try {
                    Files.deleteIfExists(output);
                } catch (IOException cleanup) {
                    exception.addSuppressed(cleanup);
                }
            }
            if (exception instanceof InterruptedException) {
                Thread.currentThread().interrupt();
            }
            throw new IllegalStateException("audio extraction failed", exception);
        }
    }

    private static void runCommand(List<String> command, Duration timeout) throws Exception {
        Process process = new ProcessBuilder(command)
                .redirectOutput(ProcessBuilder.Redirect.DISCARD)
                .redirectError(ProcessBuilder.Redirect.DISCARD)
                .start();
        try {
            if (!process.waitFor(timeout.toMillis(), TimeUnit.MILLISECONDS)) {
                // ffmpeg는 네트워크 의존이 아니므로 External Failure로 분류하지 않는다.
                throw new IOException("ffmpeg audio extraction timed out");
            }
            if (process.exitValue() != 0) {
                throw new IOException("ffmpeg exited with status " + process.exitValue());
            }
        } finally {
            if (process.isAlive()) {
                process.destroyForcibly();
                process.waitFor();
            }
        }
    }

    @FunctionalInterface
    interface CommandRunner {
        void run(List<String> command, Duration timeout) throws Exception;
    }
}
