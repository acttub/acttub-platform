package com.acttub.actingapi.practice;

import java.math.BigDecimal;
import java.math.BigInteger;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotNull;

final class PracticeSessionDtos {
    private PracticeSessionDtos() {
    }

    @ValidBlockageBranch
    @Schema(
            name = "PracticeSessionRequest",
            additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record PracticeSessionRequest(
            @NotNull UUID uploadIntentId,
            @NotNull @Schema(minLength = 1)
            String situation,
            @NotNull @Schema(minLength = 1)
            String characterContext,
            @NotNull @Schema(minLength = 1)
            String goal,
            @NotNull @Schema(allowableValues = {"분석", "표현", "그 외"}) String blockageKind,
            @NotNull @Schema(allowableValues = {
                "캐릭터 분석", "대사 분석", "감정", "움직임", "화술", "표정", "그 외"
            }) String subBranch,
            @Schema(nullable = true) String blockageDetail) {
    }

    @Schema(
            name = "PracticeSessionAcceptedResponse",
            additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record PracticeSessionAcceptedResponse(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) UUID sessionId,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, _const = "analyzing") String status) {
    }

    @Schema(
            name = "PracticeSessionCreateResponse",
            additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record PracticeSessionCreateResponse(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) UUID sessionId,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED,
                    allowableValues = {"created", "analyzing", "analyzed", "failed"})
            String status,
            @Schema(nullable = true) UUID summaryId) {
    }

    @Schema(
            name = "PracticeSessionListItem",
            additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record PracticeSessionListItem(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) UUID sessionId,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED,
                    allowableValues = {"created", "analyzing", "analyzed", "failed"})
            String status,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String situation,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String characterContext,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String goal,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED,
                    allowableValues = {"분석", "표현", "그 외"})
            String blockageKind,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String subBranch,
            @Schema(nullable = true) String blockageDetail,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) OffsetDateTime createdAt,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) OffsetDateTime updatedAt) {
    }

    @Schema(
            name = "PracticeSessionListResponse",
            additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    record PracticeSessionListResponse(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) List<PracticeSessionListItem> sessions) {
    }

    @Schema(
            name = "PracticeSessionStatusResponse",
            additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record PracticeSessionStatusResponse(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED,
                    allowableValues = {"created", "analyzing", "analyzed", "failed"})
            String status,
            @Schema(nullable = true, allowableValues = {
                "gemini_timeout", "gemini_parse_error", "unsupported_media", "max_attempts_exceeded"
            })
            @JsonProperty("error_code")
            @JsonInclude(JsonInclude.Include.ALWAYS)
            String errorCode) {
    }

    @Schema(
            name = "ObservationItem",
            additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record ObservationItem(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) BigInteger startMs,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) BigInteger endMs,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String label,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) BigDecimal confidence) {
    }

    @Schema(
            name = "ObservationPackResponse",
            additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record ObservationPackResponse(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) UUID summaryId,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) List<ObservationItem> observations,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) List<String> uncertainties) {
    }

    @Schema(
            name = "PracticeSessionDetail",
            additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record PracticeSessionDetail(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) UUID sessionId,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED,
                    allowableValues = {"created", "analyzing", "analyzed", "failed"})
            String status,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String situation,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String characterContext,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String goal,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED,
                    allowableValues = {"분석", "표현", "그 외"})
            String blockageKind,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String subBranch,
            @Schema(nullable = true) String blockageDetail,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) OffsetDateTime createdAt,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) OffsetDateTime updatedAt,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String playbackUrl,
            @Schema(nullable = true) ObservationPackResponse summary,
            @Schema(nullable = true, allowableValues = {
                "gemini_timeout", "gemini_parse_error", "unsupported_media", "max_attempts_exceeded"
            }) String errorCode) {
    }

    static ObservationPackResponse observationPack(
            UUID summaryId,
            JsonNode observations,
            JsonNode uncertainties) {
        List<ObservationItem> items = new java.util.ArrayList<>();
        observations.forEach(item -> items.add(new ObservationItem(
                item.path("start_ms").bigIntegerValue(),
                item.path("end_ms").bigIntegerValue(),
                item.path("label").textValue(),
                item.path("confidence").decimalValue())));
        List<String> uncertaintyValues = new java.util.ArrayList<>();
        uncertainties.forEach(item -> uncertaintyValues.add(item.textValue()));
        return new ObservationPackResponse(
                summaryId,
                List.copyOf(items),
                List.copyOf(uncertaintyValues));
    }
}
