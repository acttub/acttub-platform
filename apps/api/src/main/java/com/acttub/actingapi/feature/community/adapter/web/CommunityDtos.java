package com.acttub.actingapi.feature.community.adapter.web;

import java.math.BigInteger;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.PositiveOrZero;

final class CommunityDtos {
    private CommunityDtos() {
    }

    @Schema(name = "CategoryPayload", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    record CategoryPayload(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String slug,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String name,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true) String description) {
    }

    @Schema(name = "CategoryListResponse", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    record CategoryListResponse(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) List<CategoryPayload> categories) {
    }

    @Schema(
            name = "AuthorPayload",
            description = "익명이면 `id`·`nickname` 이 비고 `alias` 만 온다.\n\n"
                    + "익명 글에 실제 user id 를 실어 보내면 화면에 \"익명\" 이라 적혀 있어도 클라이언트가\n"
                    + "같은 id 로 다른 글과 묶는다. 그래서 아예 담지 않는다.",
            additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    record AuthorPayload(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true) UUID id,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true) String nickname,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true) String alias) {
    }

    @Schema(name = "PostPayload", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record PostPayload(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) UUID id,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) boolean anonymous,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String categorySlug,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String categoryName,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) AuthorPayload author,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true,
                    description = "화면에 적을 작성자 이름. 프로필의 공개 이름(챌린지와 같다, 없으면 \"배우\"), "
                            + "탈퇴했으면 \"탈퇴한 사용자\", 익명 글이면 \"익명\"")
            String authorName,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, allowableValues = {"visible", "hidden"},
                    description = "hidden 은 신고·운영으로 가려진 내 글이다. 남에게는 아예 오지 않는다")
            String status,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String title,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String body,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) int likeCount,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) int commentCount,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) int viewCount,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) boolean likedByMe,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) boolean mine,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "mine 과 같다")
            @JsonProperty("is_mine") boolean isMine,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED,
                    description = "붙은 사진(보여 줄 순서, 0~5장). 목록의 각 글에도 전부 온다")
            List<PostImagePayload> images,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) OffsetDateTime createdAt,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) OffsetDateTime updatedAt) {
    }

    @Schema(name = "CommunityPostImage", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    record PostImagePayload(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) UUID id,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true,
                    description = "서명한 보기 주소(1시간). 스토리지가 없는 기동에서는 null")
            String url) {
    }

    @Schema(name = "CommunityImageUploadRequest", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    record ImageUploadRequest(
            @NotNull @Schema(allowableValues = {"image/jpeg", "image/png", "image/webp", "image/heic"})
            @JsonProperty("mime_type") String mimeType,
            @NotNull @PositiveOrZero @Schema(description = "바이트. 10MB(10485760)까지")
            @JsonProperty("size_bytes") BigInteger sizeBytes) {
    }

    @Schema(name = "CommunityImageUploadResponse", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record ImageUploadResponse(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) UUID imageId,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "이 주소로 PUT 한다(30분)") String uploadUrl,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED,
                    description = "PUT 에 그대로 실을 헤더. 지금은 Content-Type 하나다")
            Map<String, String> uploadHeaders,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) Instant expiresAt) {
    }

    @Schema(name = "PostListResponse", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record PostListResponse(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) List<PostPayload> posts,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true) String nextCursor) {
    }

    @Schema(name = "PostWriteRequest", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record PostWriteRequest(
            @NotNull @Schema(minLength = 1) String categorySlug,
            @NotNull @Schema(minLength = 1, maxLength = 100) String title,
            @NotNull @Schema(minLength = 1, maxLength = 5000) String body,
            @Schema(defaultValue = "false") Boolean anonymous,
            @Schema(description = "붙일 사진 id(POST /v2/community/images 로 받은 것). 순서 = 보여 줄 순서, 0~5장. "
                    + "6장 이상은 400 too_many_images, 남의 것·없는 것·다른 글에 붙은 것·올라오지 않은 것은 400 invalid_image")
            List<UUID> imageIds) {
        PostWriteRequest {
            // 트리 선검증이 명시적 null 을 거부한 뒤이므로 여기의 null 은 키 생략만 뜻한다.
            anonymous = anonymous == null ? Boolean.FALSE : anonymous;
        }
    }

    @Schema(name = "PostUpdateRequest", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    record PostUpdateRequest(
            @NotNull @Schema(minLength = 1, maxLength = 100) String title,
            @NotNull @Schema(minLength = 1, maxLength = 5000) String body,
            @Schema(description = "보내면 글의 사진을 이 목록(순서 = 보여 줄 순서, 0~5장)으로 바꾼다. 빠진 사진은 떼고 지운다. "
                    + "칸을 빼면 사진은 그대로다")
            @JsonProperty("image_ids") List<UUID> imageIds) {
    }

    @Schema(name = "CommentPayload", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record CommentPayload(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) UUID id,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) UUID postId,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) boolean anonymous,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) AuthorPayload author,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true,
                    description = "화면에 적을 작성자 이름. 공개 이름, 탈퇴했으면 \"탈퇴한 사용자\", "
                            + "익명 댓글이면 별칭(\"글쓴이\"·\"익명N\")")
            String authorName,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, allowableValues = {"visible", "hidden"},
                    description = "hidden 은 신고·운영으로 가려진 내 댓글이다. 남에게는 오지 않는다")
            String status,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String body,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) boolean mine,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "mine 과 같다")
            @JsonProperty("is_mine") boolean isMine,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) OffsetDateTime createdAt,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) OffsetDateTime updatedAt) {
    }

    @Schema(name = "CommentListResponse", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record CommentListResponse(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) List<CommentPayload> comments,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true) String nextCursor) {
    }

    @Schema(name = "CommentWriteRequest", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    record CommentWriteRequest(
            @NotNull @Schema(minLength = 1, maxLength = 1000) String body,
            @Schema(defaultValue = "false") Boolean anonymous) {
        CommentWriteRequest {
            anonymous = anonymous == null ? Boolean.FALSE : anonymous;
        }
    }

    @Schema(name = "LikeResponse", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record LikeResponse(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) int likeCount,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) boolean likedByMe) {
    }

    @Schema(name = "ReportRequest", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record ReportRequest(
            @NotNull @Schema(allowableValues = {"post", "comment"}) String targetType,
            @NotNull UUID targetId,
            @NotNull @Schema(allowableValues = {
                    "copyright", "inappropriate", "spam", "duplicate", "other", "abuse", "sexual", "privacy"})
            String reason,
            @Schema(nullable = true, maxLength = 500) String detail) {
    }

    @Schema(name = "BlockPayload", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record BlockPayload(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) UUID userId,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true) String nickname) {
    }

    @Schema(name = "BlockListResponse", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    record BlockListResponse(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) List<BlockPayload> blocks) {
    }

    @Schema(name = "BlockRequest", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record BlockRequest(@NotNull UUID userId) {
    }
}
