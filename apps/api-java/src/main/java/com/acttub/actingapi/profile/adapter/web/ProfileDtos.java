package com.acttub.actingapi.profile.adapter.web;

import java.util.UUID;

import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotNull;

final class ProfileDtos {
    private ProfileDtos() {
    }

    @Schema(name = "MeResponse", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record MeResponse(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) UUID id,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true) String email,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true) String nickname,
            @Schema(
                    requiredMode = Schema.RequiredMode.REQUIRED,
                    allowableValues = {"active", "suspended", "deactivated"})
            String status) {
    }

    @Schema(name = "UpdateMeRequest", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    record UpdateMeRequest(
            @NotNull
            @Schema(minLength = 1, maxLength = 20)
            String nickname) {
    }
}
