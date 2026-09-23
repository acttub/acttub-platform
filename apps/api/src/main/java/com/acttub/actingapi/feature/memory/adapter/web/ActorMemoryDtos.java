package com.acttub.actingapi.feature.memory.adapter.web;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.memory.domain.MemoryValue;
import com.fasterxml.jackson.annotation.JsonProperty;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

/** 1.0.0 배우 기억의 요청·응답 (practice.memory). 셋 다 unknown key 를 거부한다. */
final class ActorMemoryDtos {
    private ActorMemoryDtos() {
    }

    @Schema(name = "ActorMemoryItem", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    record ActorMemoryItem(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, title = "Field",
                    allowableValues = {"goal", "blockage", "speech_self", "speech_actual"})
            String field,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, title = "Value") String value,
            // 참이면 배우가 직접 쓰거나 고친 칸이다. 화면이 "내가 적은 값"을 구분해 보여줘야
            // 무엇이 자동으로 적힌 것인지 안다.
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, title = "Written By Actor")
            @JsonProperty("written_by_actor") boolean writtenByActor,
            // 워커가 적은 칸이 어느 회차에서 나왔는지. 출처 회차가 숨겨졌으면 값은 그대로고 여기가 비는다.
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, title = "Source Practice Id", nullable = true)
            @JsonProperty("source_practice_id") UUID sourcePracticeId,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, title = "Updated At")
            @JsonProperty("updated_at") Instant updatedAt) {
    }

    @Schema(name = "ActorMemoryResponse", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    record ActorMemoryResponse(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, title = "Items")
            List<ActorMemoryItem> items) {
    }

    @Schema(name = "UpdateActorMemoryRequest", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    record UpdateActorMemoryRequest(
            @NotNull @Size(max = MemoryValue.MAX_LENGTH)
            @Schema(title = "Value", minLength = 1, maxLength = MemoryValue.MAX_LENGTH)
            String value) {
    }
}
