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
    @Schema(name = "PracticeNoteRecordRef", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record PracticeNoteRecordRef(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String recordId,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, minimum = "1") int version,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, minimum = "1") long durationMs) { }

    @Schema(name = "PracticeNoteDirection", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record PracticeNoteDirection(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String text,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, allowableValues = {"actor_stated", "actor_selected", "coach_proposed"}) String origin) { }

    @Schema(name = "PracticeNoteFocus", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record PracticeNoteFocus(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String label,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true) Long startMs,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true) Long endMs,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true) String quote) { }

    @Schema(name = "PracticeNotePractice", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record PracticeNotePractice(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String proposalId,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, allowableValues = {"proposed", "selected"}) String selection,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String instruction,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String comparison,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true) String keep) { }

    @Schema(name = "PracticeNoteResult", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record PracticeNoteResult(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, allowableValues = {"closer", "further", "mixed", "same", "unclear"}) String direction,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String statement,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, _const = "actor_report") String basis) { }

    @Schema(name = "PracticeNoteAttempt", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record PracticeNoteAttempt(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String attemptId,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String proposalId,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String instruction,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, allowableValues = {"unknown", "not_tried", "reported_tried"}) String execution,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true) PracticeNoteResult result) { }

    @Schema(name = "PracticeNoteEvidence", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record PracticeNoteEvidence(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String id,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, allowableValues = {"video_utterance", "video_observation", "record_limitation"}) String kind,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String text,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true) Long startMs,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true) Long endMs) { }

    @Schema(name = "PublicPracticeNote", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    public record PublicPracticeNote(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, _const = "acttub.public_practice_note.v1") String schemaVersion,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, _const = "practice_note") String reportType,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String noteId,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, minimum = "1") int revision,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String title,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true) String summary,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, allowableValues = {"action", "observation", "record_only"}) String mode,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, allowableValues = {"actor_finished", "turn_budget", "interrupted", "system_failure"}) String endReason,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true) PracticeNoteRecordRef recordRef,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, allowableValues = {"draft", "saved"}) String lifecycle,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true) PracticeNoteDirection direction,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true) PracticeNoteFocus focus,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true) String reading,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true) PracticeNotePractice practice,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) List<PracticeNoteAttempt> attempts,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) List<String> openPoints,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) List<PracticeNoteEvidence> evidence) { }


}
