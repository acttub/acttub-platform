package com.acttub.actingapi.feature.challenge.app;

import static io.swagger.v3.oas.annotations.media.Schema.RequiredMode.REQUIRED;

import java.time.Clock;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executor;
import java.util.concurrent.RejectedExecutionException;
import com.acttub.actingapi.feature.challenge.app.EntryRepository.ShareFrameSource;
import com.acttub.actingapi.feature.challenge.domain.ShareFrames;
import com.acttub.actingapi.feature.video.app.VideoObjectCleanup;
import com.acttub.actingapi.platform.observability.FailureContext;
import com.acttub.actingapi.platform.observability.FailureReporter;
import com.acttub.actingapi.platform.web.ApiException;
import com.acttub.actingapi.platform.web.ApiValidationException;
import io.swagger.v3.oas.annotations.media.Schema;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Service;
import tools.jackson.databind.PropertyNamingStrategies;
import tools.jackson.databind.annotation.JsonNaming;

/**
 * 인스타 공유·영상 저장에 씌우는 프레임 (challenge.entry 공유 프레임, SOMA-1156). 본인 참여작에만 만든다.
 *
 * <p><b>영상</b>은 오래 걸리므로 요청 스레드에서 만들지 않는다. 처음 요청이 자기 실행기(스레드 하나, ffmpeg 는
 * {@code FfmpegLock} 차례)에 맡기고 {@code rendering} 을 돌려주면 앱이 같은 요청을 다시 보내 기다린다. 만든 영상은 참여작에
 * 키를 적어 두고 다음부터 바로 내준다. 만드는 중·실패는 이 프로세스의 메모리에만 있다 — 재시작으로 잃으면 다음 요청이 다시
 * 만든다. 실패는 한 번 {@code failed} 로 알리고 지운다. 그다음 요청이 다시 만든다.
 *
 * <p><b>미리보기</b>는 영상 한 장면이라 요청 안에서 만든다(저장소 주소에서 한 장면만 읽는다). 이것도 키를 적어 둔다.
 */
@Service
public class EntryShareFrameService {
    private enum State { RENDERING, FAILED }

    private final EntryRepository entries;
    private final EntryShareFrames frames;
    private final EntryMedia media;
    private final VideoObjectCleanup cleanup;
    private final FailureReporter failures;
    private final Executor executor;
    private final Clock clock;
    private final Map<String, State> jobs = new ConcurrentHashMap<>();

    public EntryShareFrameService(EntryRepository entries, EntryShareFrames frames, EntryMedia media, VideoObjectCleanup cleanup,
                                  FailureReporter failures, @Qualifier("entryShareFrameExecutor") Executor executor, Clock clock) {
        this.entries = entries; this.frames = frames; this.media = media; this.cleanup = cleanup; this.failures = failures;
        this.executor = executor; this.clock = clock;
    }

    @Schema(name = "ChallengeEntryShareFrameVideo", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record FrameVideo(
            @Schema(requiredMode = REQUIRED, allowableValues = {"rendering", "ready", "failed"}, description = """
                    rendering 이면 만드는 중이라 같은 요청을 다시 보낸다. failed 는 한 번만 알리고, 그다음 요청이 다시
                    만든다.""") String status,
            @Schema(requiredMode = REQUIRED, nullable = true, description = "ready 일 때만. 10분 동안 받을 수 있는 mp4 주소")
            String videoUrl) { }

    @Schema(name = "ChallengeEntryShareFramePreview", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record FramePreview(
            @Schema(requiredMode = REQUIRED, description = "10분 동안 받을 수 있는 JPEG 주소(폭 540)") String imageUrl) { }

    public FrameVideo video(UUID owner, UUID entryId, String frameId) {
        ShareFrames.Frame frame = frame(frameId, "body");
        ShareFrameSource source = framable(entries.shareFrameSource(owner, entryId));
        String key = ShareFrames.videoKey(source.objectKey(), entryId, frame, source.mosaic());
        if (source.renderedKeys().contains(key)) return new FrameVideo("ready", media.playbackUrl(key));
        if (jobs.remove(key, State.FAILED)) return new FrameVideo("failed", null);
        frames.requireConfigured();
        if (jobs.putIfAbsent(key, State.RENDERING) == null) {
            try {
                executor.execute(() -> render(source, frame, key));
            } catch (RejectedExecutionException busy) {
                // 줄이 찼다 — 다음 요청이 다시 맡긴다.
                jobs.remove(key, State.RENDERING);
            }
        }
        return new FrameVideo("rendering", null);
    }

    /**
     * {@code frameId} 가 {@value ShareFrames#NONE} 이면 틀 없이 장면만 보인다(「없음」). 「없음」은 지금처럼 본인 재생과 같은
     * 장면이라 모자이크본을 기다리지 않는다.
     */
    public FramePreview preview(UUID owner, UUID entryId, String frameId) {
        ShareFrames.Frame frame = ShareFrames.NONE.equals(frameId) ? null : frame(frameId, "path");
        ShareFrameSource source = entries.shareFrameSource(owner, entryId);
        if (frame != null) framable(source);
        String key = ShareFrames.previewKey(source.objectKey(), entryId, frame, source.mosaic());
        if (!source.renderedKeys().contains(key)) {
            frames.requireConfigured();
            frames.renderPreview(card(source, frame), source.sourceKey(), key);
            cleanup.attemptObjectDelete(entries.attachShareFrame(source, key, clock.instant()));
        }
        return new FramePreview(media.playbackUrl(key));
    }

    private void render(ShareFrameSource source, ShareFrames.Frame frame, String key) {
        try {
            frames.renderVideo(card(source, frame), source.sourceKey(), key);
            cleanup.attemptObjectDelete(entries.attachShareFrame(source, key, clock.instant()));
            jobs.remove(key);
        } catch (RuntimeException failure) {
            failures.report(failure, new FailureContext("EntryShareFrameService.render", source.entryId()));
            jobs.put(key, State.FAILED);
        }
    }

    /** 얼굴 가림을 켰는데 모자이크본이 아직 없으면 원본에 씌우지 않고 422 mosaic_not_ready 다(만드는 중·실패 모두). */
    private static ShareFrameSource framable(ShareFrameSource source) {
        if (source.mosaicPending()) throw new ApiException(422, "mosaic_not_ready");
        return source;
    }

    static ShareFrames.Card card(ShareFrameSource source, ShareFrames.Frame frame) {
        return new ShareFrames.Card(frame, source.line(), source.number(), source.authorName(),
                ShareFrames.stampDate(source.createdAt()));
    }

    private static ShareFrames.Frame frame(String id, String place) {
        ShareFrames.Frame frame = ShareFrames.Frame.of(id);
        if (frame == null) throw ApiValidationException.valueError(List.of(place, "frame"), "Value error, invalid frame", id);
        return frame;
    }
}
