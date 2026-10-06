package com.acttub.actingapi.integration.media;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.List;
import java.util.concurrent.TimeUnit;
import java.util.function.Function;

/**
 * {@link AudioExtractor}·{@link AudioTranscoder}·{@link PosterFrameExtractor} 가 ffmpeg 로 파일 하나를 만드는 방식.
 * 입력 옆에 임시 파일을 만들고 {@link FfmpegLock} 을 잡고 돌린다. 빈 출력은 실패다. 실패하면 부분 출력을 지우고
 * 원래 예외를 그대로 던진다 — 무엇으로 감쌀지는 부르는 쪽이 정한다. ffmpeg 는 네트워크 의존이 아니라 External
 * Failure 로 분류하지 않는다.
 *
 * <p>압축({@link GeminiVideoCompressor})은 실패하면 원본으로 돌아가는 다른 계약이라 여기를 쓰지 않는다.
 */
public final class Ffmpeg {
    private Ffmpeg() {
    }

    @FunctionalInterface
    public interface CommandRunner {
        void run(List<String> command, Duration timeout) throws Exception;
    }

    /** 진짜 ffmpeg 프로세스. 시간이 넘으면 {@code ffmpeg <job> timed out} 으로 끝낸다. */
    static CommandRunner process(String job) {
        return (command, timeout) -> {
            Process process = new ProcessBuilder(command)
                    .redirectOutput(ProcessBuilder.Redirect.DISCARD)
                    .redirectError(ProcessBuilder.Redirect.DISCARD)
                    .start();
            try {
                if (!process.waitFor(timeout.toMillis(), TimeUnit.MILLISECONDS)) {
                    throw new IOException("ffmpeg " + job + " timed out");
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
        };
    }

    /**
     * {@code source} 옆에 {@code prefix*suffix} 파일을 만들어 그 경로로 명령을 짓고 돌린다. 반환한 파일은 호출자가
     * 지운다.
     */
    static Path produce(
            CommandRunner runner,
            Duration timeout,
            Path source,
            String prefix,
            String suffix,
            Function<Path, List<String>> command,
            String emptyMessage) throws Exception {
        Path output = null;
        try {
            output = Files.createTempFile(source.toAbsolutePath().getParent(), prefix, suffix);
            List<String> arguments = command.apply(output);
            FfmpegLock.run(() -> {
                runner.run(arguments, timeout);
                return null;
            });
            if (Files.size(output) == 0) {
                throw new IOException(emptyMessage);
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
            throw exception;
        }
    }
}
