package com.acttub.actingapi.feature.upload.adapter.web;

import java.math.BigInteger;
import java.time.Instant;
import java.util.UUID;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;

final class UploadDtos {
    private UploadDtos() {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    @Schema(name = "UploadIntentRequest")
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record UploadIntentRequest(
            @NotNull String mimeType,
            // 경계값의 3.1 표기와 float 표현은 PydanticOpenApiCustomizer 가 맞춘다.
            @NotNull @Positive(message = "Input should be greater than 0")
            @Schema(minimum = "0", exclusiveMinimum = true) BigInteger sizeBytes,
            @Positive(message = "Input should be greater than 0")
            @Schema(nullable = true, minimum = "0", exclusiveMinimum = true) BigInteger durationMs) {
    }

    @Schema(name = "UploadIntentResponse", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record UploadIntentResponse(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) UUID intentId,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String uploadUrl,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) Instant expiresAt) {
    }

    @Schema(name = "UploadCompleteResponse", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record UploadCompleteResponse(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) UUID intentId,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, _const = "finalized") String status) {
    }
}
