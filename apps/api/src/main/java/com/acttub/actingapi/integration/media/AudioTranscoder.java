package com.acttub.actingapi.integration.media;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.List;
import java.util.concurrent.TimeUnit;

/**
 * 어떤 형식의 음성이든 m4a(AAC)로 바꾼다 — 리딩 녹음의 저장 형식은 하나여야 이관 뒤 앱에서 웹 녹음을 들을 수 있다
 * (reading.recording, ADR-031). 내용은 읽지 않는다: 서버가 음성을 건드리는 유일한 일이다.
 *
 * <p>영상 파이프라인의 {@link AudioExtractor} 와 같은 방식으로 ffmpeg 를 부르고 같은 {@link FfmpegLock} 을 잡는다.
 * 반환한 파일은 호출자가 지운다. 실패하면 부분 출력을 지우고 원인을 담아 던진다 — ffmpeg 는 네트워크 의존이 아니라
 * External Failure 로 분류하지 않는다.
 */
public final class AudioTranscoder {
    static final Duration TIMEOUT = Duration.ofSeconds(120);
    private final CommandRunner runner;

    public AudioTranscoder() {
        this(AudioTranscoder::runCommand);
    }

    public AudioTranscoder(CommandRunner runner) {
        this.runner = runner;
    }

    /** {@code source} 옆에 {@code .m4a} 파일을 만든다. 원본은 그대로 둔다. */
    public Path toM4a(Path source) {
        Path output = null;
        try {
            output = Files.createTempFile(source.toAbsolutePath().getParent(), "acttub-recording-", ".m4a");
            List<String> command = List.of(
                    "ffmpeg", "-y", "-threads", "1", "-i", source.toString(),
                    "-vn", "-c:a", "aac", "-b:a", "64k", "-movflags", "+faststart",
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
            throw new TranscodeFailed(exception);
        }
    }

    private static void runCommand(List<String> command, Duration timeout) throws Exception {
        Process process = new ProcessBuilder(command)
                .redirectOutput(ProcessBuilder.Redirect.DISCARD)
                .redirectError(ProcessBuilder.Redirect.DISCARD)
                .start();
        try {
            if (!process.waitFor(timeout.toMillis(), TimeUnit.MILLISECONDS)) {
                throw new IOException("ffmpeg audio transcode timed out");
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

    /** 변환하지 못했다 — 부르는 쪽이 503 {@code audio_conversion_failed} 로 답하고 기기가 같은 요청 id 로 다시 시도한다. */
    public static final class TranscodeFailed extends RuntimeException {
        TranscodeFailed(Throwable cause) {
            super("audio transcode failed", cause);
        }
    }

    @FunctionalInterface
    public interface CommandRunner {
        void run(List<String> command, Duration timeout) throws Exception;
    }
}
