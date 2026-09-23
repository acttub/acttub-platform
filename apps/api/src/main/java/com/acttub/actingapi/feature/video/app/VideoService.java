package com.acttub.actingapi.feature.video.app;

import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Clock;
import java.time.Instant;
import java.util.HexFormat;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.video.app.VideoRepository.Completed;
import com.acttub.actingapi.feature.video.app.VideoRepository.IntentView;
import com.acttub.actingapi.feature.video.app.VideoRepository.NewIntent;
import com.acttub.actingapi.feature.video.app.VideoRepository.Removed;
import com.acttub.actingapi.feature.video.app.VideoRepository.Reserved;
import com.acttub.actingapi.feature.video.app.VideoViews.NewUpload;
import com.acttub.actingapi.feature.video.app.VideoViews.VideoPage;
import com.acttub.actingapi.feature.video.app.VideoViews.VideoView;
import com.acttub.actingapi.feature.video.domain.VideoRules;
import com.acttub.actingapi.platform.web.ApiException;

/**
 * 보관함의 규칙 — 영상은 연습에서 독립한 자산이다 (practice.record, practice.library).
 *
 * <p>올리기는 세 단계다: <b>올릴 자리 받기 · (기기가) 올리기 · 마무리</b>. 예약 장부({@code upload_intents})가
 * 요청 id·본문 지문·객체 키·시한·확정 video_id 를 들고 있어 마무리 재전송이 같은 영상을 돌려준다. 시한이 지난
 * 미확정 객체는 장부가 지운다.
 *
 * <p>거절은 규칙이라 본문이 사유 코드 하나다(CONTRACT §6-2): 파일 {@code video_too_large}, 길이
 * {@code video_too_long}, 총량 {@code video_quota}, 시한 {@code upload_expired}, 아직 안 올라옴
 * {@code video_not_ready}, 참조 {@code video_in_use}, 같은 요청 id 에 다른 본문
 * {@code request_fingerprint_mismatch}.
 *
 * <p><b>바깥 호출(저장소)은 트랜잭션 밖이다</b>(§5-4). 주소를 받고 올라온 객체를 확인하는 일은 여기서 하고,
 * 총량을 세고 영상을 만드는 일만 저장소가 <b>사용자 행을 잠근 채</b> 한다 — 한도 직전의 동시 업로드 둘 가운데
 * 하나만 확정되는 이유다.
 */
public class VideoService {

    private final VideoRepository videos;
    private final VideoStorage storage;
    private final VideoObjectCleanup cleanup;
    private final Clock clock;

    public VideoService(VideoRepository videos, VideoStorage storage, VideoObjectCleanup cleanup, Clock clock) {
        this.videos = videos;
        this.storage = storage;
        this.cleanup = cleanup;
        this.clock = clock;
    }

    /**
     * 올릴 자리를 내준다. 기기도 같은 값을 검사하지만 서버가 다시 본다 — 한도를 넘은 메타는 여기서 걸린다.
     *
     * @param contentType 매개변수를 뗀 MP4·MOV 여야 한다. 그 밖은 부르는 쪽이 값 오류(422 배열)로 거절한다
     */
    public NewUpload createIntent(
            UUID userId, boolean guest, UUID requestId, String contentType, long byteSize, int durationMs) {
        if (byteSize > VideoRules.FILE_MAX_BYTES) {
            throw new ApiException(422, "video_too_large");
        }
        if (durationMs > VideoRules.DURATION_MAX_MS) {
            throw new ApiException(422, "video_too_long");
        }
        storage.requireConfigured();
        Instant now = clock.instant();
        Reserved reserved = videos.reserve(
                userId,
                new NewIntent(
                        requestId,
                        fingerprint(contentType, byteSize, durationMs),
                        VideoRules.objectKey(userId, requestId, contentType),
                        contentType,
                        byteSize,
                        durationMs,
                        now.plus(VideoRules.INTENT_TTL)),
                VideoRules.quotaBytes(guest),
                now);
        switch (reserved.outcome()) {
            case QUOTA -> throw new ApiException(422, "video_quota");
            case MISMATCH -> throw new ApiException(422, "request_fingerprint_mismatch");
            default -> { }
        }
        // 재전송이면 먼저 예약한 키로 주소를 다시 만든다 — 기기가 올리다 만 객체를 이어 올린다.
        String uploadUrl = storage.presignUpload(
                reserved.objectKey(), contentType, byteSize, Math.toIntExact(VideoRules.INTENT_TTL.toSeconds()));
        return new NewUpload(reserved.intentId(), uploadUrl, reserved.expiresAt());
    }

    /**
     * 올라온 것을 확인하고 보관함에 영상을 만든다. 판정 순서가 응답을 가른다 — 이미 확정된 예약은 시한을 보기
     * 전에 같은 영상을 돌려주고(응답만 유실된 마무리의 재시도), 시한이 지난 예약은 저장소에 묻기 전에 치운다.
     */
    public Completion completeIntent(UUID userId, boolean guest, UUID intentId) {
        storage.requireConfigured();
        Instant now = clock.instant();
        IntentView intent = videos.findIntent(userId, intentId);
        if (intent == null) {
            throw new ApiException(404, "upload_intent_not_found");
        }
        if (intent.videoId() != null) {
            VideoView already = videos.find(userId, intent.videoId());
            if (already != null) {
                return new Completion(false, playback(already));
            }
        }
        if (!now.isBefore(intent.expiresAt())) {
            cleanup.attemptObjectDelete(videos.expireIntent(userId, intentId, now));
            throw new ApiException(422, "upload_expired");
        }
        VideoStorage.Stored stored = storage.head(intent.objectKey());
        if (stored == null) {
            throw new ApiException(422, "video_not_ready");
        }
        Completed completed = videos.complete(userId, intentId, stored, VideoRules.quotaBytes(guest), now);
        cleanup.attemptObjectDelete(completed.cleanupOperationIds());
        return switch (completed.outcome()) {
            case CREATED -> new Completion(true, playback(completed.video()));
            case REPLAYED -> new Completion(false, playback(completed.video()));
            case NOT_FOUND -> throw new ApiException(404, "upload_intent_not_found");
            case EXPIRED -> throw new ApiException(422, "upload_expired");
            case QUOTA -> throw new ApiException(422, "video_quota");
            case SIZE_MISMATCH -> throw new ApiException(422, "video_not_ready");
        };
    }

    /** @param created 새로 만들었으면 201, 재전송이면 200 이다 */
    public record Completion(boolean created, VideoView video) {
    }

    /**
     * 보관함 목록. 최신 저장순이고 재생 주소는 싣지 않는다 — 한 쪽에서 서른 개의 주소를 만들 이유가 없고 상세를
     * 열 때 새로 받는다.
     */
    public VideoPage list(UUID userId, String filter, String cursor) {
        return videos.list(userId, filter, cursor, VideoRules.PAGE_SIZE, clock.instant());
    }

    /** 영상 상세 — 재생 주소가 붙는다. 파기된 영상은 주소가 없다. */
    public VideoView find(UUID userId, UUID videoId) {
        return playback(require(videos.find(userId, videoId)));
    }

    public VideoView setFavorite(UUID userId, UUID videoId, boolean favorite) {
        return playback(require(videos.setFavorite(userId, videoId, favorite, clock.instant())));
    }

    /** 참조(회차·참여작)가 없을 때만 지운다. 있으면 422 {@code video_in_use} 이고 아무것도 지우지 않는다. */
    public void delete(UUID userId, UUID videoId) {
        Removed removed = videos.delete(userId, videoId, clock.instant());
        cleanup.attemptObjectDelete(removed.cleanupOperationIds());
        switch (removed.outcome()) {
            case NOT_FOUND -> throw notFound();
            case IN_USE -> throw new ApiException(422, "video_in_use");
            default -> { }
        }
    }

    /**
     * 파일만 파기한다 — 총량이 가득한 계정이 공간을 되찾는 길이다. 회차·참여작의 기록은 남고 그 영상은 재생
     * 불가로 표시된다.
     */
    public VideoView purgeFile(UUID userId, UUID videoId) {
        Removed removed = videos.purgeFile(userId, videoId, clock.instant());
        cleanup.attemptObjectDelete(removed.cleanupOperationIds());
        return switch (removed.outcome()) {
            case PURGED -> removed.video();
            case IN_USE -> throw new ApiException(422, "video_in_use");
            default -> throw notFound();
        };
    }

    /** 시한이 지난 미확정 예약을 치운다. 매일 도는 일이 부른다. */
    public int sweepExpiredIntents() {
        List<UUID> scheduled = videos.sweepExpiredIntents(clock.instant());
        cleanup.attemptObjectDelete(scheduled);
        return scheduled.size();
    }

    private VideoView playback(VideoView video) {
        if (video == null || video.purgedAt() != null) {
            return video;
        }
        String url = storage.presignPlayback(video.objectKey(), VideoRules.PLAYBACK_TTL_SECONDS);
        return url == null
                ? video
                : video.withPlayback(url, clock.instant().plusSeconds(VideoRules.PLAYBACK_TTL_SECONDS));
    }

    private static VideoView require(VideoView video) {
        if (video == null) {
            throw notFound();
        }
        return video;
    }

    private static ApiException notFound() {
        return new ApiException(404, "video_not_found");
    }

    /** 형식·크기·길이를 묶은 지문. 같은 요청 id 로 다른 영상을 올리려는 것을 가른다. */
    static String fingerprint(String contentType, long byteSize, int durationMs) {
        String payload = "video_intent|" + contentType + "|" + byteSize + "|" + durationMs;
        try {
            return HexFormat.of().formatHex(
                    MessageDigest.getInstance("SHA-256").digest(payload.getBytes(java.nio.charset.StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("SHA-256 is unavailable", exception);
        }
    }
}
