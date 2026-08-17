package com.acttub.actingapi.feature.report.app;

import java.util.List;

import io.swagger.v3.oas.annotations.media.Schema;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;

/**
 * 성적표 본문의 <b>공개 스키마</b>. 갈래별로 어떤 필드가 반드시 있는지가 여기 적혀 있고, 그것이
 * 곧 계약이다.
 *
 * <p><b>web 이 아니라 app 에 산다.</b> 성적표 본문은 코치 응답에도 그대로 실리므로 {@code coach} 가
 * 이 모양을 참조해야 하는데, feature 끼리는 상대의 <b>app</b> 층만 본다(ADR-019). 엔드포인트의
 * 입출력 봉투({@code ReportReq}·{@code ReportDetailResponse} 등)는 web 에 남는다 — 그쪽은 이
 * 도메인의 HTTP 표면이지 다른 도메인이 알 것이 아니다.
 *
 * <p>이 record 들은 <b>호출되지 않는다.</b> 실제 본문은 모델이 낸 JSON 을 {@code ReportEngine} 이
 * 검증한 {@code JsonNode} 이고, 여기 있는 것은 springdoc 이 읽어 OpenAPI 문서를 만드는 선언이다.
 * 그래서 필드가 어긋나도 컴파일이 막아 주지 않는다 — 지키는 것은 엔진의 검증과
 * {@code OpenApiSnapshotIT} 다.
 */
public final class PublicReport {

    private PublicReport() {
    }

    @Schema(
            name = "AnalysisNextTake",
            additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    public record AnalysisNextTake(
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
    public record EffectiveExperiment(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String instruction,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, _const = "true") boolean tested) {
    }

    @Schema(name = "ActorTraining", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record ActorTraining(
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
    public record SourceHandoffIds(
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
