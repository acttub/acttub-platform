package com.acttub.actingapi.community.adapter.web;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotNull;

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
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String title,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String body,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) int likeCount,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) int commentCount,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) int viewCount,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) boolean likedByMe,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) boolean mine,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) OffsetDateTime createdAt,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) OffsetDateTime updatedAt) {
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
            @Schema(defaultValue = "false") Boolean anonymous) {
        PostWriteRequest {
            // 트리 선검증이 명시적 null 을 거부한 뒤이므로 여기의 null 은 키 생략만 뜻한다.
            anonymous = anonymous == null ? Boolean.FALSE : anonymous;
        }
    }

    @Schema(name = "PostUpdateRequest", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    record PostUpdateRequest(
            @NotNull @Schema(minLength = 1, maxLength = 100) String title,
            @NotNull @Schema(minLength = 1, maxLength = 5000) String body) {
    }

    @Schema(name = "CommentPayload", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record CommentPayload(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) UUID id,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) UUID postId,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) boolean anonymous,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) AuthorPayload author,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String body,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) boolean mine,
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
            @NotNull @Schema(allowableValues = {"spam", "abuse", "sexual", "privacy", "other"})
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
