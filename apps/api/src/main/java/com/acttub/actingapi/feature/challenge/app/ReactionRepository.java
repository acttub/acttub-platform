package com.acttub.actingapi.feature.challenge.app;

import static io.swagger.v3.oas.annotations.media.Schema.RequiredMode.REQUIRED;

import java.time.Instant;
import java.util.List;
import java.util.UUID;
import com.acttub.actingapi.feature.challenge.app.ChallengeRepository.Participant;
import com.acttub.actingapi.feature.challenge.app.EntryRepository.EntryCard;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import io.swagger.v3.oas.annotations.media.Schema;

/**
 * 좋아요·저장·댓글·차단 (challenge.react, challenge.block). 반응은 보는 사람에게 보이는 참여작에만 되고, 저장은
 * 보는 사람·작성자 행과 참여작 행을 잠근 채 조건을 다시 확인한다. 볼 수 없는 대상은 404 다.
 */
public interface ReactionRepository {
    Liked like(UUID viewer, UUID entryId, boolean on, Instant now);
    Saved save(UUID viewer, UUID entryId, boolean on, Instant now);
    SavedEntries saved(UUID viewer, String cursor);
    CommentPage comments(UUID viewer, UUID entryId, String cursor);
    CommentCreation comment(UUID viewer, UUID entryId, UUID requestId, String fingerprint, String body, Instant now);
    void deleteComment(UUID viewer, UUID commentId, Instant now);
    Blocked block(UUID viewer, UUID target, boolean on, Instant now);
    BlockList blocks(UUID viewer);

    record CommentCreation(Comment comment, boolean created) { }

    @Schema(name = "EntryLikeState", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record Liked(@Schema(requiredMode = REQUIRED) long likeCount, @Schema(requiredMode = REQUIRED) boolean liked) { }

    @Schema(name = "EntrySaveState", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record Saved(@Schema(requiredMode = REQUIRED) boolean saved) { }

    @Schema(name = "SavedChallengeEntries", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record SavedEntries(@Schema(requiredMode = REQUIRED) List<EntryCard> entries,
                        @Schema(requiredMode = REQUIRED, description = "삭제되지 않은 내 참여작 수") long myEntryCount,
                        @Schema(requiredMode = REQUIRED, description = "지금 보이는 저장한 참여작 수") long savedCount,
                        @Schema(requiredMode = REQUIRED, nullable = true) String nextCursor) { }

    @Schema(name = "EntryComment", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record Comment(@Schema(requiredMode = REQUIRED) UUID id,
                   @Schema(requiredMode = REQUIRED, description = "현재 프로필 이름만. 탈퇴했으면 \"탈퇴한 사용자\"") Participant author,
                   @Schema(requiredMode = REQUIRED, nullable = true) String body,
                   @Schema(requiredMode = REQUIRED) Instant createdAt,
                   @Schema(requiredMode = REQUIRED) boolean isMine,
                   @Schema(requiredMode = REQUIRED) boolean authorWithdrawn,
                   @Schema(requiredMode = REQUIRED, allowableValues = {"visible", "hidden"},
                           description = "hidden 은 신고로 숨겨진 내 댓글이다(작성자에게만 온다)") String status) { }

    @Schema(name = "EntryCommentPage", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record CommentPage(@Schema(requiredMode = REQUIRED) List<Comment> comments,
                       @Schema(requiredMode = REQUIRED, nullable = true) String nextCursor) { }

    @Schema(name = "UserBlockState", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record Blocked(@Schema(requiredMode = REQUIRED) UUID userId, @Schema(requiredMode = REQUIRED) boolean blocked) { }

    @Schema(name = "BlockedUser", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record BlockedUser(@Schema(requiredMode = REQUIRED) UUID userId, @Schema(requiredMode = REQUIRED) String name,
                       @Schema(requiredMode = REQUIRED) Instant createdAt) { }

    @Schema(name = "BlockedUsers", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record BlockList(@Schema(requiredMode = REQUIRED) List<BlockedUser> users) { }
}
