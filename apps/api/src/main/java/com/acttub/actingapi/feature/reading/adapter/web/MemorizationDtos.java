package com.acttub.actingapi.feature.reading.adapter.web;

import java.time.Instant;
import java.util.UUID;

import com.acttub.actingapi.platform.schema.MemorizationStatus;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotNull;

final class MemorizationDtos {
    private MemorizationDtos() {
    }

    /** 배우가 남기는 표시 — "이 대사 외웠어요"({@code memorized})·"아직 헷갈려요"({@code not_yet}). */
    @Schema(name = "ReadingMemorizationRequest", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    record SetRequest(@NotNull StatusInput status) {
    }

    /** 값 이름은 DB CHECK 값이자 API 값이다({@link MemorizationStatus}). */
    @Schema(name = "ReadingMemorizationStatusInput")
    enum StatusInput {
        memorized,
        not_yet
    }

    /** 줄 하나의 표시. 행이 없는 줄은 목록에 없다 — 아직 표시하지 않은 줄이다. */
    @Schema(name = "ReadingLineMemorization", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record MemorizationResponse(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) UUID lineId,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, implementation = MemorizationStatus.class) String status,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) Instant updatedAt) {
    }
}
