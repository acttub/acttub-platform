package com.acttub.actingapi.integration.media;

import java.nio.file.Path;
import java.time.Duration;
import java.util.List;

/**
 * 영상에서 포스터 한 장(JPEG)을 뽑는다 — 보관함 목록의 미리보기다(practice.library).
 *
 * <p>0.5초 자리의 한 장면이다. 맨 앞 장면은 검거나 초점이 덜 잡힌 경우가 많아서다 — 1초보다 짧거나 길이를 모르면
 * 맨 앞이다(그 뒤에는 장면이 없을 수 있다). 폭은 480px 이하로 줄이고 높이는 비율을 따라 짝수로 맞춘다. 기기가 찍은
 * 회전 정보는 ffmpeg 가 디코딩하며 반영한다.
 *
 * <p>ffmpeg 는 {@link Ffmpeg} 의 방식으로 부른다. 반환한 파일은 호출자가 지운다. 실패하면 부분 출력을 지우고 원인을
 * 담아 던진다.
 */
public final class PosterFrameExtractor {
    static final Duration TIMEOUT = Duration.ofSeconds(60);
    /** 포스터의 최대 폭(px). 목록의 썸네일로는 충분하고 한 장이 수십 KB 에 머문다. */
    static final int MAX_WIDTH = 480;
    private final Ffmpeg.CommandRunner runner;

    public PosterFrameExtractor() {
        this(Ffmpeg.process("poster extraction"));
    }

    public PosterFrameExtractor(Ffmpeg.CommandRunner runner) {
        this.runner = runner;
    }

    /**
     * {@code video} 옆에 {@code .jpg} 파일을 만든다. 원본은 그대로 둔다.
     *
     * @param durationMs 영상 길이. 모르면 0 이다
     */
    public Path extract(Path video, int durationMs) {
        try {
            return Ffmpeg.produce(runner, TIMEOUT, video, "acttub-poster-", ".jpg", output -> List.of(
                    "ffmpeg", "-y", "-threads", "1", "-ss", durationMs >= 1_000 ? "0.5" : "0",
                    "-i", video.toString(),
                    "-frames:v", "1", "-vf", "scale='min(" + MAX_WIDTH + ",iw)':-2", "-q:v", "4", "-an",
                    "-threads", "1", output.toString()), "ffmpeg produced an empty poster");
        } catch (Exception exception) {
            throw new ExtractionFailed(exception);
        }
    }

    /** 포스터를 뽑지 못했다 — 워커가 보고하고 다음 주기에 다시 시도한다(상한까지). */
    public static final class ExtractionFailed extends RuntimeException {
        ExtractionFailed(Throwable cause) {
            super("poster extraction failed", cause);
        }
    }
}
