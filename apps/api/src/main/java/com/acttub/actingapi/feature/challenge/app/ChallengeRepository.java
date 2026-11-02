package com.acttub.actingapi.feature.challenge.app;

import static io.swagger.v3.oas.annotations.media.Schema.RequiredMode.REQUIRED;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import io.swagger.v3.oas.annotations.media.Schema;

public interface ChallengeRepository {
    Creation create(UUID owner, UUID requestId, String fingerprint, Draft draft, Instant now);
    Creation createTeam(UUID requestId, String fingerprint, Draft draft, LocalDate featuredOn, Instant now);
    Card moderate(UUID id, String moderation, Instant now);
    boolean delete(UUID owner, UUID id, Instant now);
    Card find(UUID viewer, UUID id);
    Listing list(UUID viewer, String tab, String query, Instant now, Position cursor);

    record Draft(String line, String work, String character, String sceneNote, int durationDays) { }
    /** 대사 목록의 마지막 정렬 값. */
    record Position(Instant at, UUID id, long likes, long entries) { }
    record Creation(Card card, boolean created) { }
    @Schema(name = "ChallengeList", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record Listing(@Schema(requiredMode = REQUIRED, nullable = true) Card featured,
                   @Schema(requiredMode = REQUIRED) List<Card> challenges,
                   @Schema(requiredMode = REQUIRED, nullable = true) String nextCursor) { }

    @Schema(name = "ChallengeParticipant", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record Participant(@Schema(requiredMode = REQUIRED) UUID userId, @Schema(requiredMode = REQUIRED) String name,
                       @Schema(requiredMode = REQUIRED, nullable = true,
                               description = "프로필 사진을 볼 짧은 주소. 사진이 없거나, 탈퇴했거나, 얼굴 가림을 켠 참여작의 작성자이면 null")
                       String photoUrl) { }
    @Schema(name = "Challenge", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record Card(@Schema(requiredMode = REQUIRED) UUID id,
                @Schema(requiredMode = REQUIRED) String line,
                @Schema(requiredMode = REQUIRED) String work,
                @Schema(requiredMode = REQUIRED, nullable = true) String character,
                @Schema(requiredMode = REQUIRED, nullable = true) String sceneNote,
                @Schema(requiredMode = REQUIRED, allowableValues = {"team", "member"}) String origin,
                @Schema(requiredMode = REQUIRED, nullable = true) String hostName,
                @Schema(requiredMode = REQUIRED) boolean isHost,
                @Schema(requiredMode = REQUIRED) Instant startsAt,
                @Schema(requiredMode = REQUIRED) Instant endsAt,
                @Schema(requiredMode = REQUIRED, nullable = true, type = "string", format = "date") String featuredOn,
                @Schema(requiredMode = REQUIRED, allowableValues = {"visible", "review", "hidden"}) String moderation,
                @Schema(requiredMode = REQUIRED) long entryCount,
                @Schema(requiredMode = REQUIRED) long likeSum,
                @Schema(requiredMode = REQUIRED) List<Participant> participants,
                @Schema(requiredMode = REQUIRED) long moreCount,
                @Schema(requiredMode = REQUIRED, nullable = true, allowableValues = {"pending", "final"}) String rankingState) { }
}
