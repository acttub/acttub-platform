package com.acttub.actingapi.feature.transfer.adapter.web;

import java.time.Instant;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotNull;

final class GuestTransferDtos {
    private GuestTransferDtos() {
    }

    /** 코드는 이 응답에서만 보인다 — 서버는 해시만 저장한다. 웹은 {@code expires_in} 으로 남은 시간을 센다. */
    @Schema(name = "TransferCodeResponse", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record TransferCodeResponse(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String code,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) long expiresIn,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) Instant expiresAt) {
    }

    @Schema(name = "GuestTransferRequest", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    record GuestTransferRequest(
            @NotNull String code,
            // 409 memory_choice_required 를 받은 뒤에만 싣는다.
            @JsonProperty("memory_choice") MemoryChoice memoryChoice) {
    }

    /** 회원과 게스트 둘 다 배우 기억이 있을 때 어느 쪽을 둘지. 고른 쪽만 남는다. */
    @Schema(name = "MemoryChoice")
    enum MemoryChoice {
        member,
        guest
    }

    @Schema(name = "GuestTransferResponse", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    record GuestTransferResponse(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) boolean transferred) {
    }
}
