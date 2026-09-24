package com.acttub.actingapi.feature.video.app;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Clock;
import java.util.Comparator;
import java.util.List;
import java.util.UUID;
import java.util.stream.Stream;

import com.acttub.actingapi.feature.video.app.VideoRepository.PosterJob;
import com.acttub.actingapi.feature.video.domain.VideoRules;
import com.acttub.actingapi.integration.media.PosterFrameExtractor;
import com.acttub.actingapi.platform.observability.FailureContext;
import com.acttub.actingapi.platform.observability.FailureReporter;

/**
 * 보관함 포스터를 만든다 — 목록의 미리보기 한 장이다 (practice.library).
 *
 * <p><b>올리기를 막지 않는다.</b> 마무리는 포스터를 기다리지 않고 영상을 돌려주며, 이 워커가 뒤에서
 * {@code poster_key} 가 빈 영상을 하나씩 집는다. 새 영상과 이 기능 이전에 올라온 영상(백필)을 같은 길로 채운다 —
 * 최신 저장순이라 방금 올린 영상이 밀린 옛 영상보다 먼저다.
 *
 * <p>한 번은 <b>집기(시도 횟수를 올려 커밋) · 받기 · 한 장면 뽑기 · 올리기 · 붙이기</b>다. 바깥 호출(저장소·ffmpeg)은
 * 트랜잭션 밖이다(§5-4). 실패하면 보고만 하고 다음 주기에 다시 집힌다 — {@link VideoRules#POSTER_MAX_ATTEMPTS} 번
 * 집힌 영상은 더 고르지 않는다. 뽑는 사이에 영상이 지워지거나 파기되면 붙이지 않고 올린 포스터를 장부가 지운다.
 */
public class VideoPosterWorker {

    private final VideoRepository videos;
    private final VideoStorage storage;
    private final PosterFrameExtractor frames;
    private final VideoObjectCleanup cleanup;
    private final FailureReporter failures;
    private final Clock clock;

    public VideoPosterWorker(
            VideoRepository videos,
            VideoStorage storage,
            PosterFrameExtractor frames,
            VideoObjectCleanup cleanup,
            FailureReporter failures,
            Clock clock) {
        this.videos = videos;
        this.storage = storage;
        this.frames = frames;
        this.cleanup = cleanup;
        this.failures = failures;
        this.clock = clock;
    }

    /**
     * 영상 하나를 처리한다.
     *
     * @return 영상을 집었으면 {@code true}(성공·실패와 무관하다). 할 일이 없거나 스토리지가 없으면 {@code false}
     */
    public boolean runOnce() {
        if (!storage.configured()) {
            return false;
        }
        PosterJob job = videos.claimPoster(VideoRules.POSTER_MAX_ATTEMPTS);
        if (job == null) {
            return false;
        }
        try {
            generate(job);
        } catch (RuntimeException failure) {
            // 포스터는 부가물이다 — 목록은 poster_url 없이 그대로 열린다.
            failures.report(failure, new FailureContext("VideoPosterWorker.generate"));
        }
        return true;
    }

    private void generate(PosterJob job) {
        Path directory = null;
        try {
            directory = Files.createTempDirectory("acttub-poster-");
            Path video = directory.resolve("source");
            storage.download(job.objectKey(), video);
            Path poster = frames.extract(video, job.durationMs());
            String posterKey = VideoRules.posterKey(job.objectKey());
            storage.upload(posterKey, "image/jpeg", poster);
            List<UUID> scheduled = videos.attachPoster(job, posterKey, clock.instant());
            cleanup.attemptObjectDelete(scheduled);
        } catch (IOException exception) {
            throw new java.io.UncheckedIOException(exception);
        } finally {
            delete(directory);
        }
    }

    private static void delete(Path directory) {
        if (directory == null) {
            return;
        }
        try (Stream<Path> paths = Files.walk(directory)) {
            paths.sorted(Comparator.reverseOrder()).forEach(path -> path.toFile().delete());
        } catch (IOException ignored) {
            // 임시 파일이 남아도 다음 기동의 임시 디렉터리 정리에 맡긴다.
        }
    }
}
