package com.acttub.actingapi.feature.video.app;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/** 보관함이 밖으로 보여 주는 모양 (practice.record, practice.library). */
public final class VideoViews {

    private VideoViews() {
    }

    /**
     * 영상 한 편. {@code purgedAt} 이 있으면 객체·받아쓰기가 없어 재생할 수 없고 총량에서도 빠진다 —
     * 그래도 회차·참여작의 기록은 그대로다.
     *
     * @param playbackUrl 상세에서만 채운다(목록은 {@code null}). 스토리지가 없거나 파기됐으면 {@code null}
     * @param posterKey 워커가 만든 포스터의 객체 키. 아직 없으면 {@code null}
     * @param posterUrl 목록·상세 모두 채운다. 포스터가 아직 없거나 스토리지가 없거나 파기됐으면 {@code null}
     */
    public record VideoView(
            UUID id,
            String objectKey,
            String contentType,
            long byteSize,
            int durationMs,
            boolean favorite,
            Instant purgedAt,
            Instant createdAt,
            int practiceCount,
            int entryCount,
            String playbackUrl,
            Instant playbackExpiresAt,
            String posterKey,
            String posterUrl) {

        public VideoView withPlayback(String url, Instant expiresAt) {
            return new VideoView(id, objectKey, contentType, byteSize, durationMs, favorite, purgedAt, createdAt,
                    practiceCount, entryCount, url, expiresAt, posterKey, posterUrl);
        }

        public VideoView withPoster(String url) {
            return new VideoView(id, objectKey, contentType, byteSize, durationMs, favorite, purgedAt, createdAt,
                    practiceCount, entryCount, playbackUrl, playbackExpiresAt, posterKey, url);
        }
    }

    /** @param nextCursor 다음 쪽이 없으면 {@code null} */
    public record VideoPage(List<VideoView> videos, String nextCursor) {
    }

    /** 올릴 자리 하나. */
    public record NewUpload(UUID intentId, String uploadUrl, Instant expiresAt) {
    }
}
