package com.acttub.actingapi.feature.video.adapter.web;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.video.app.VideoViews.VideoView;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.PositiveOrZero;

final class VideoDtos {
    private VideoDtos() {
    }

    /** 올릴 자리 요청. 기기가 720px 로 줄인 업로드본의 메타를 보낸다(원본은 서버에 두지 않는다). */
    @Schema(name = "VideoIntentRequest", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record IntentRequest(
            @NotNull UUID requestId,
            @NotNull String contentType,
            @NotNull @PositiveOrZero Long byteSize,
            @NotNull @Positive Integer durationMs) {
    }

    @Schema(name = "VideoIntent", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record IntentResponse(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) UUID intentId,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String uploadUrl,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) Instant expiresAt) {
    }

    /** 이 영상을 쓰는 곳. 화면은 삭제가 막혔을 때 이것을 보여 준다. */
    @Schema(name = "VideoUsage", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record UsageResponse(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) int practiceCount,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) int entryCount) {
    }

    /**
     * 보관함의 영상 한 편. {@code purgedAt} 이 있으면 파일이 없어 재생할 수 없다. {@code playbackUrl} 은
     * 상세에서만 채운다 — 목록은 {@code null} 이다.
     */
    @Schema(name = "Video", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record VideoResponse(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) UUID id,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) int durationMs,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) long byteSize,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String contentType,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) boolean favorite,
            @Schema(nullable = true) Instant purgedAt,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) Instant createdAt,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) UsageResponse usage,
            @Schema(nullable = true) String playbackUrl,
            @Schema(nullable = true) Instant playbackExpiresAt) {

        static VideoResponse of(VideoView view) {
            return new VideoResponse(
                    view.id(),
                    view.durationMs(),
                    view.byteSize(),
                    view.contentType(),
                    view.favorite(),
                    view.purgedAt(),
                    view.createdAt(),
                    new UsageResponse(view.practiceCount(), view.entryCount()),
                    view.playbackUrl(),
                    view.playbackExpiresAt());
        }
    }

    /** @param nextCursor 다음 쪽이 없으면 {@code null} */
    @Schema(name = "VideoList", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record VideoListResponse(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) List<VideoResponse> videos,
            @Schema(nullable = true) String nextCursor) {
    }

    /** 즐겨찾기 토글. 보낸 것만 바꾼다. */
    @Schema(name = "VideoPatch", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    record PatchRequest(@NotNull Boolean favorite) {
    }
}
