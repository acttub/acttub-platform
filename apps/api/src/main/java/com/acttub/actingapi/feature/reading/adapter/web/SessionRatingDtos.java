package com.acttub.actingapi.feature.reading.adapter.web;

import java.time.Instant;
import java.util.UUID;

import com.acttub.actingapi.feature.reading.app.SessionRatingStore.Rating;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;

/** 리딩 회차 평가의 요청·응답 (reading.session, SOMA-661). 요청은 unknown key 를 거부한다. 노트 평가와 같은 모양이다. */
final class SessionRatingDtos {
    private SessionRatingDtos() {
    }

    /**
     * @param comment 한 줄(선택). 앞뒤 공백을 걷은 1~100자이고 비었으면 없는 것이다. 덮어쓸 때 빼면 한 줄도 비운다
     */
    @Schema(name = "ReadingSessionRatingRequest", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record SessionRatingRequest(
            @NotNull @Schema(requiredMode = Schema.RequiredMode.REQUIRED) UUID requestId,
            @NotNull @Pattern(regexp = "good|bad")
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, allowableValues = {"good", "bad"})
            String rating,
            @Schema(nullable = true, description = "앞뒤 공백을 걷은 1~100 유니코드 코드 포인트. 비었으면 없는 것이다.")
            String comment) {
    }

    /** 남긴 평가. 저장 응답이자 회차 조회의 {@code my_rating} 이다. */
    @Schema(name = "ReadingSessionRating", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record SessionRatingResponse(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, allowableValues = {"good", "bad"})
            String rating,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true) String comment,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) Instant updatedAt) {

        static SessionRatingResponse of(Rating rating) {
            return rating == null ? null : new SessionRatingResponse(rating.rating(), rating.comment(), rating.updatedAt());
        }
    }
}
