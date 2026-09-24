package com.acttub.actingapi.integration.media;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.List;
import java.util.concurrent.TimeUnit;

/**
 * 영상에서 포스터 한 장(JPEG)을 뽑는다 — 보관함 목록의 미리보기다(practice.library).
 *
 * <p>0.5초 자리의 한 장면이다. 맨 앞 장면은 검거나 초점이 덜 잡힌 경우가 많아서다 — 1초보다 짧거나 길이를 모르면
 * 맨 앞이다(그 뒤에는 장면이 없을 수 있다). 폭은 480px 이하로 줄이고 높이는 비율을 따라 짝수로 맞춘다. 기기가 찍은
 * 회전 정보는 ffmpeg 가 디코딩하며 반영한다.
 *
 * <p>{@link AudioExtractor}·{@link AudioTranscoder} 와 같은 방식으로 ffmpeg 를 부르고 같은 {@link FfmpegLock} 을
 * 잡는다. 반환한 파일은 호출자가 지운다. 실패하면 부분 출력을 지우고 원인을 담아 던진다.
 */
public final class PosterFrameExtractor {
    static final Duration TIMEOUT = Duration.ofSeconds(60);
    /** 포스터의 최대 폭(px). 목록의 썸네일로는 충분하고 한 장이 수십 KB 에 머문다. */
    static final int MAX_WIDTH = 480;
    private final CommandRunner runner;

    public PosterFrameExtractor() {
        this(PosterFrameExtractor::runCommand);
    }

    public PosterFrameExtractor(CommandRunner runner) {
        this.runner = runner;
    }

    /**
     * {@code video} 옆에 {@code .jpg} 파일을 만든다. 원본은 그대로 둔다.
     *
     * @param durationMs 영상 길이. 모르면 0 이다
     */
    public Path extract(Path video, int durationMs) {
        Path output = null;
        try {
            output = Files.createTempFile(video.toAbsolutePath().getParent(), "acttub-poster-", ".jpg");
            List<String> command = List.of(
                    "ffmpeg", "-y", "-threads", "1", "-ss", durationMs >= 1_000 ? "0.5" : "0",
                    "-i", video.toString(),
                    "-frames:v", "1", "-vf", "scale='min(" + MAX_WIDTH + ",iw)':-2", "-q:v", "4", "-an",
                    "-threads", "1", output.toString());
            FfmpegLock.run(() -> {
                runner.run(command, TIMEOUT);
                return null;
            });
            if (Files.size(output) == 0) {
                throw new IOException("ffmpeg produced an empty poster");
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
            throw new ExtractionFailed(exception);
        }
    }

    private static void runCommand(List<String> command, Duration timeout) throws Exception {
        Process process = new ProcessBuilder(command)
                .redirectOutput(ProcessBuilder.Redirect.DISCARD)
                .redirectError(ProcessBuilder.Redirect.DISCARD)
                .start();
        try {
            if (!process.waitFor(timeout.toMillis(), TimeUnit.MILLISECONDS)) {
                // ffmpeg 는 네트워크 의존이 아니므로 External Failure 로 분류하지 않는다.
                throw new IOException("ffmpeg poster extraction timed out");
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

    /** 포스터를 뽑지 못했다 — 워커가 보고하고 다음 주기에 다시 시도한다(상한까지). */
    public static final class ExtractionFailed extends RuntimeException {
        ExtractionFailed(Throwable cause) {
            super("poster extraction failed", cause);
        }
    }

    @FunctionalInterface
    public interface CommandRunner {
        void run(List<String> command, Duration timeout) throws Exception;
    }
}
