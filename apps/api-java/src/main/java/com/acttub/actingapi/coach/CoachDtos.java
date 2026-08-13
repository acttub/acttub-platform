package com.acttub.actingapi.coach;

import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.report.ReportDtos.AnalysisReport;
import com.acttub.actingapi.report.ReportDtos.BlockedReport;
import com.acttub.actingapi.report.ReportDtos.ExpressionReport;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotNull;

public final class CoachDtos {
    private CoachDtos() {
    }

    @Schema(name = "CoachStartReq", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record CoachStartReq(
            @NotNull UUID practiceSessionId,
            @Schema(defaultValue = "false") Boolean restart) {
        public CoachStartReq {
            restart = restart == null ? Boolean.FALSE : restart;
        }
    }

    @Schema(name = "CoachReplyReq", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record CoachReplyReq(
            @NotNull UUID sessionId,
            @NotNull String text) {
    }

    @ValidCoachConfirm
    @Schema(name = "CoachConfirmReq", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record CoachConfirmReq(
            @NotNull UUID coachSessionId,
            @NotNull Boolean confirmed,
            @Schema(nullable = true) String rebuttalText) {
    }

    @Schema(name = "PublicHandoff", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record PublicHandoff(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) UUID id,
            @Schema(
                    requiredMode = Schema.RequiredMode.REQUIRED,
                    allowableValues = {"analysis", "expression"})
            String branchKind) {
    }

    @Schema(name = "PublicCoachTurn", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    public record PublicCoachTurn(
            @Schema(
                    requiredMode = Schema.RequiredMode.REQUIRED,
                    allowableValues = {"actor", "ai"})
            String role,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String text) {
    }

    @Schema(name = "CoachTurnResponse", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record CoachTurnResponse(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) UUID sessionId,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String message,
            @Schema(
                    requiredMode = Schema.RequiredMode.REQUIRED,
                    allowableValues = {"continue", "complete"})
            String status,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true)
            PublicHandoff handoff,
            @Schema(
                    requiredMode = Schema.RequiredMode.REQUIRED,
                    nullable = true,
                    anyOf = {AnalysisReport.class, ExpressionReport.class, BlockedReport.class})
            JsonNode report,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED)
            List<PublicCoachTurn> turns) {
    }

    @Schema(
            name = "CoachConfirmResponse",
            additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record CoachConfirmResponse(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) UUID sessionId,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) boolean confirmed,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true)
            PublicHandoff handoff,
            @Schema(
                    requiredMode = Schema.RequiredMode.REQUIRED,
                    anyOf = {AnalysisReport.class, ExpressionReport.class, BlockedReport.class})
            JsonNode report) {
    }
}
