package com.acttub.actingapi.report.adapter.web;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.report.app.PublicReport.AnalysisReport;
import com.acttub.actingapi.report.app.PublicReport.ExpressionReport;
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

}
