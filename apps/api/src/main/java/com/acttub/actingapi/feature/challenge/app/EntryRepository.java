package com.acttub.actingapi.feature.challenge.app;

import static io.swagger.v3.oas.annotations.media.Schema.RequiredMode.REQUIRED;

import java.time.Instant;
import java.util.List;
import java.util.UUID;
import com.acttub.actingapi.feature.challenge.app.ChallengeRepository.Participant;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import io.swagger.v3.oas.annotations.media.Schema;

/**
 * 참여작의 저장소 (challenge.entry, challenge.browse). 검사와 쓰기는 사용자 → 챌린지 → 영상 순서로 행을 잠근 한
 * 트랜잭션에서 한다. 마감 뒤 챌린지에 처음 닿는 변경은 쓰기 전에 마감 집계를 먼저 한다.
 */
public interface EntryRepository {
    /** 본인의 확정된 영상. 없거나 남의 것이면 {@code null}. */
    OwnVideo video(UUID owner, UUID videoId);
    /** 이 id 가 본인의 아직 확정되지 않은 업로드 예약인가. */
    boolean pendingUpload(UUID owner, UUID id);
    /** 같은 요청 id 로 이미 만든 참여작(삭제된 것 포함). 없으면 {@code null}. */
    Replay replay(UUID owner, UUID requestId);
    Creation create(UUID owner, UUID challengeId, UUID requestId, String fingerprint, NewEntry entry, Instant now);
    /** @param caption {@code null} 이면 그대로, 빈 문자열이면 지운다 @param visibility {@code null} 이면 그대로 */
    MyEntry update(UUID owner, UUID entryId, String caption, String visibility, Instant now);
    void delete(UUID owner, UUID entryId, Instant now);
    /** @return 사건을 새로 반영했으면 {@code true}(본인 재생·같은 사건 재전송은 {@code false}) */
    boolean view(UUID viewer, UUID entryId, UUID eventId, Instant now);
    EntryPage list(UUID viewer, UUID challengeId, String sort, String cursor, UUID fromEntry, Instant now);
    EntryCard find(UUID viewer, UUID entryId, Instant now);
    MyEntries mine(UUID owner, String category, String cursor, Instant now);
    /** 매시 도는 일: 마감이 지난 챌린지의 집계·확정과 기한 지난 조회수 사건·커서 정리. */
    int settle(Instant now);

    record OwnVideo(UUID id, String objectKey, int declaredDurationMs, boolean purged) { }
    record NewEntry(UUID videoId, String caption, String visibility) { }
    record Replay(String fingerprint, MyEntry entry) { }
    record Creation(MyEntry entry, boolean created) { }

    @Schema(name = "ChallengeEntry", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record EntryCard(@Schema(requiredMode = REQUIRED) UUID id,
                     @Schema(requiredMode = REQUIRED) UUID challengeId,
                     @Schema(requiredMode = REQUIRED) Participant author,
                     @Schema(requiredMode = REQUIRED, nullable = true) String caption,
                     @Schema(requiredMode = REQUIRED) long likeCount,
                     @Schema(requiredMode = REQUIRED) long commentCount,
                     @Schema(requiredMode = REQUIRED) long viewCount,
                     @Schema(requiredMode = REQUIRED, nullable = true,
                             description = "전체 기준 공동 순위. 최신순이거나 좋아요가 모두 0이거나 집계 중이면 null") Integer rank,
                     @Schema(requiredMode = REQUIRED, nullable = true, description = "종료 뒤 저장된 좋아요 수") Long finalLikeCount,
                     @Schema(requiredMode = REQUIRED, nullable = true) Instant publishedAt,
                     @Schema(requiredMode = REQUIRED, nullable = true) String playbackUrl,
                     @Schema(requiredMode = REQUIRED) boolean liked,
                     @Schema(requiredMode = REQUIRED) boolean saved,
                     @Schema(requiredMode = REQUIRED) boolean isMine,
                     @Schema(requiredMode = REQUIRED, description = "최신순 첫 항목") boolean isNew) { }

    @Schema(name = "ChallengeEntryPage", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record EntryPage(@Schema(requiredMode = REQUIRED) List<EntryCard> entries,
                     @Schema(requiredMode = REQUIRED, nullable = true) String nextCursor,
                     @Schema(requiredMode = REQUIRED, nullable = true, allowableValues = {"pending", "final"}) String rankingState) { }

    @Schema(name = "MyChallengeEntryParent", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record Parent(@Schema(requiredMode = REQUIRED) UUID id, @Schema(requiredMode = REQUIRED) String line,
                  @Schema(requiredMode = REQUIRED) String work, @Schema(requiredMode = REQUIRED, nullable = true) String character,
                  @Schema(requiredMode = REQUIRED) Instant endsAt) { }

    @Schema(name = "MyChallengeEntry", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record MyEntry(@Schema(requiredMode = REQUIRED) UUID id,
                   @Schema(requiredMode = REQUIRED) UUID challengeId,
                   @Schema(requiredMode = REQUIRED) Participant author,
                   @Schema(requiredMode = REQUIRED, nullable = true) String caption,
                   @Schema(requiredMode = REQUIRED) int contentVersion,
                   @Schema(requiredMode = REQUIRED) long likeCount,
                   @Schema(requiredMode = REQUIRED) long commentCount,
                   @Schema(requiredMode = REQUIRED) long viewCount,
                   @Schema(requiredMode = REQUIRED, nullable = true) Integer rank,
                   @Schema(requiredMode = REQUIRED, nullable = true) Long finalLikeCount,
                   @Schema(requiredMode = REQUIRED, nullable = true) Instant publishedAt,
                   @Schema(requiredMode = REQUIRED, nullable = true) String playbackUrl,
                   @Schema(requiredMode = REQUIRED) boolean liked,
                   @Schema(requiredMode = REQUIRED) boolean saved,
                   @Schema(requiredMode = REQUIRED) boolean isMine,
                   @Schema(requiredMode = REQUIRED, allowableValues = {"public", "private"}) String visibility,
                   @Schema(requiredMode = REQUIRED, allowableValues = {"visible", "hidden_by_report", "deleted"}) String status,
                   @Schema(requiredMode = REQUIRED, allowableValues = {"public", "private", "under_review"},
                           description = "P03 분류. 확인 중 → 비공개 → 공개 순으로 한 곳에만 든다") String category,
                   @Schema(requiredMode = REQUIRED) boolean challengeHidden,
                   @Schema(requiredMode = REQUIRED) Parent challenge,
                   @Schema(requiredMode = REQUIRED) Instant createdAt) { }

    @Schema(name = "MyChallengeEntryCounts", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record Counts(@Schema(requiredMode = REQUIRED) long all, @JsonProperty("public") @Schema(requiredMode = REQUIRED) long publicCount,
                  @JsonProperty("private") @Schema(requiredMode = REQUIRED) long privateCount,
                  @Schema(requiredMode = REQUIRED) long underReview) { }

    @Schema(name = "MyChallengeEntries", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record MyEntries(@Schema(requiredMode = REQUIRED) Counts counts,
                     @Schema(requiredMode = REQUIRED) List<MyEntry> entries,
                     @Schema(requiredMode = REQUIRED, nullable = true) String nextCursor) { }
}
