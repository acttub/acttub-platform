package com.acttub.actingapi.report;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotNull;

public final class ReportDtos {
    private ReportDtos() {
    }

    @Schema(name = "ReportReq", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record ReportReq(@NotNull UUID sessionId) {
    }

    @Schema(name = "ReportRecord", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record ReportRecord(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) UUID practiceSessionId,
            @Schema(
                    requiredMode = Schema.RequiredMode.REQUIRED,
                    allowableValues = {"analysis", "expression"})
            String reportType,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String title,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) OffsetDateTime createdAt) {
    }

    @Schema(
            name = "ReportHistoryResponse",
            additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    record ReportHistoryResponse(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) long count,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) List<ReportRecord> reports) {
    }

    @Schema(
            name = "ReportDetailResponse",
            additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record ReportDetailResponse(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) UUID practiceSessionId,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) OffsetDateTime createdAt,
            @Schema(
                    requiredMode = Schema.RequiredMode.REQUIRED,
                    anyOf = {AnalysisReport.class, ExpressionReport.class})
            JsonNode report,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String playbackUrl) {
    }

    @Schema(
            name = "AnalysisNextTake",
            additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    record AnalysisNextTake(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String direction,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, _const = "false") boolean tested) {
    }

    @Schema(name = "AnalysisReport", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record AnalysisReport(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, _const = "analysis")
            String reportType,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String title,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String actorDiscovery,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String lineMeaning,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String timingReason,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String targetEffect,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) AnalysisNextTake nextTake,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String actingCaution,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) List<String> evidence,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) List<String> uncertainties,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String sourceHandoffId) {
    }

    @Schema(
            name = "EffectiveExperiment",
            additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    record EffectiveExperiment(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String instruction,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, _const = "true") boolean tested) {
    }

    @Schema(name = "ActorTraining", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record ActorTraining(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String title,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String purpose,
            @Schema(
                    requiredMode = Schema.RequiredMode.REQUIRED,
                    anyOf = {Integer.class, Double.class})
            Number durationMinutes,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) List<String> steps,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String focus,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String successCheck,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, _const = "false") boolean tested) {
    }

    @Schema(
            name = "SourceHandoffIds",
            additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    record SourceHandoffIds(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true) String analysis,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String expression) {
    }

    @Schema(name = "ExpressionReport", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record ExpressionReport(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, _const = "expression")
            String reportType,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String title,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String blockedPoint,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String expressionCore,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String lineMeaning,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String timingReason,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String playableAction,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) EffectiveExperiment effectiveExperiment,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String observedChange,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String nextTake,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String actingTrap,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) ActorTraining actorTraining,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) List<String> evidence,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) List<String> actorWords,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) List<String> uncertainties,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) SourceHandoffIds sourceHandoffIds) {
    }

    @Schema(name = "BlockedReport", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record BlockedReport(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, _const = "blocked")
            String reportType,
            @Schema(
                    requiredMode = Schema.RequiredMode.REQUIRED,
                    allowableValues = {
                        "confirmed_analysis_handoff_required",
                        "confirmed_expression_handoff_required"
                    })
            String reason) {
    }
}
