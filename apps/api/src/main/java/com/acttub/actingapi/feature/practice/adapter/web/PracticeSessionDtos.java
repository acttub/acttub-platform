package com.acttub.actingapi.feature.practice.adapter.web;

import java.math.BigDecimal;
import java.math.BigInteger;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.practice.domain.ObservationPack;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import io.swagger.v3.oas.annotations.media.Schema;

public final class PracticeSessionDtos {
    private PracticeSessionDtos() {
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
    public record ObservationPackResponse(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) UUID summaryId,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) List<ObservationItem> observations,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) List<String> uncertainties) {
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
    @Schema(name = "VideoRecordRange", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record VideoRecordRange(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) long startMs,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) long endMs) { }

    @Schema(name = "VideoRecordLimit", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record VideoRecordLimit(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) long startMs,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) long endMs,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String description) { }

    @Schema(name = "VideoRecordSummaryResponse", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record VideoRecordSummaryResponse(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, _const = "acttub.video_record_summary.v1") String schemaVersion,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) UUID recordId,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) int recordVersion,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) long durationMs,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, allowableValues = {"ready", "partial"}) String status,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) List<VideoRecordRange> processedRanges,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) List<VideoRecordRange> missingRanges,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) List<String> observedScene,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) List<String> spokenContent,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) List<VideoRecordLimit> limitations) { }

    static VideoRecordSummaryResponse videoRecord(com.acttub.actingapi.feature.practice.domain.VideoRecordSummary record) {
        return new VideoRecordSummaryResponse("acttub.video_record_summary.v1", record.recordId(), record.recordVersion(),
                record.durationMs(), record.status(),
                record.processedRanges().stream().map(r -> new VideoRecordRange(r.startMs(), r.endMs())).toList(),
                record.missingRanges().stream().map(r -> new VideoRecordRange(r.startMs(), r.endMs())).toList(),
                record.observedScene(), record.spokenContent(),
                record.limitations().stream().map(l -> new VideoRecordLimit(l.startMs(), l.endMs(), l.description())).toList());
    }

}
