package com.acttub.actingapi.feature.practice.adapter.web;

import java.math.BigDecimal;
import java.math.BigInteger;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.practice.domain.ObservationPack;
import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
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
    // 값 하나짜리 허용 목록은 컨트롤러가, 둘의 조합은 이 애노테이션이 본다. 둘 다 근거는
    // domain/BlockageBranch 이고, 나뉘어 있는 이유는 오류 형태다 — 조합 위반은 pydantic 이
    // 모델 검증 오류로 내던 것이라 loc 이 다르다.
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

    static ObservationPackResponse observationPack(ObservationPack pack) {
        return new ObservationPackResponse(
                pack.summaryId(),
                pack.observations().stream()
                        .map(item -> new ObservationItem(
                                item.startMs(),
                                item.endMs(),
                                item.label(),
                                item.confidence()))
                        .toList(),
                List.copyOf(pack.uncertainties()));
    }
}
