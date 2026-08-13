package com.acttub.actingapi.memory;

import java.util.List;
import java.util.UUID;

import com.fasterxml.jackson.annotation.JsonProperty;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotNull;

/** `actor_memory.py` 의 응답·요청 모델. 셋 다 unknown key 를 거부한다(`extra="forbid"`). */
final class MemoryDtos {
    private MemoryDtos() {
    }

    /** 저장 계층과 같은 값이어야 한다. DB 제약(`ck_actor_memory_value_length`)이 최종 방어선이다. */
    static final int VALUE_MAX_LENGTH = 1000;

    static final List<String> FIELD_NAMES =
            List.of("gender", "age", "goal", "blockage", "speech_self", "speech_actual");

    @Schema(name = "MemoryItem", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    record MemoryItem(
            @Schema(
                    requiredMode = Schema.RequiredMode.REQUIRED,
                    title = "Field",
                    allowableValues = {"gender", "age", "goal", "blockage", "speech_self", "speech_actual"})
            String field,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, title = "Value") String value,
            // True 면 배우가 직접 쓰거나 고친 칸이다. 화면에서 "내가 고친 항목" 을 구분해
            // 보여줘야 배우가 무엇이 자동으로 적힌 것인지 안다.
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, title = "Edited By Me")
            @JsonProperty("edited_by_me") boolean editedByMe,
            // 에이전트가 적은 칸이 어느 연습에서 나왔는지. 근거를 못 보면 고칠지 판단이 안 선다.
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, title = "Source Practice Session Id",
                    nullable = true)
            @JsonProperty("source_practice_session_id") UUID sourcePracticeSessionId) {
    }

    @Schema(name = "MemoryResponse", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    record MemoryResponse(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, title = "Items")
            List<MemoryItem> items) {
    }

    @Schema(name = "UpdateMemoryRequest", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    record UpdateMemoryRequest(
            @NotNull @Schema(title = "Value", minLength = 1, maxLength = VALUE_MAX_LENGTH)
            String value) {
    }
}
