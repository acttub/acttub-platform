package com.acttub.actingapi.feature.reading.adapter.web;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.platform.schema.ReadingAdvance;
import com.acttub.actingapi.platform.schema.ReadingMode;
import com.acttub.actingapi.platform.schema.ReadingSessionStatus;
import com.acttub.actingapi.platform.schema.TranscriptSource;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.PositiveOrZero;

final class SessionDtos {
    private SessionDtos() {
    }

    /** 회차의 속성은 시작할 때 정하고 뒤에 바꾸지 않는다. 내 배역은 하나 이상이어야 하고(규칙, 422 invalid_characters) 그 대본의 배역이다. */
    @Schema(name = "ReadingSessionCreateRequest", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    record CreateRequest(
            @NotNull @JsonProperty("request_id") UUID requestId,
            @NotNull @JsonProperty("my_character_ids") List<@NotNull UUID> myCharacterIds,
            @NotNull ModeInput mode,
            @NotNull @JsonProperty("start_line_id") UUID startLineId,
            @NotNull @JsonProperty("end_line_id") UUID endLineId,
            @NotNull AdvanceInput advance,
            @NotNull Boolean record) {
    }

    /** 값 이름은 DB CHECK 값이자 API 값이다({@link ReadingMode}). */
    @Schema(name = "ReadingModeInput")
    enum ModeInput {
        read,
        quiz
    }

    /** 값 이름은 DB CHECK 값이자 API 값이다({@link ReadingAdvance}). */
    @Schema(name = "ReadingAdvanceInput")
    enum AdvanceInput {
        silence,
        manual
    }

    /**
     * 진행 저장. {@code progress_seq} 는 기기가 1씩 늘리는 순번이고 서버는 저장된 값보다 큰 요청만 반영한다. 보낸 항목만
     * 바꾼다 — 위치는 구간 안 대사 줄, 시간은 누적(줄지 않음), 줄 결과는 마지막 사건이 이긴다. {@code complete} 는 구간
     * 끝을 지났다는 뜻이다.
     */
    @Schema(name = "ReadingSessionProgressRequest", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    record ProgressRequest(
            @NotNull @PositiveOrZero @JsonProperty("progress_seq") Long progressSeq,
            @Schema(nullable = true) @JsonProperty("current_line_id") UUID currentLineId,
            @Schema(nullable = true) @PositiveOrZero @JsonProperty("elapsed_seconds") Integer elapsedSeconds,
            @Schema(nullable = true) @Valid @JsonProperty("line_results") List<@NotNull @Valid LineResultInput> lineResults,
            @Schema(nullable = true) Boolean complete) {
    }

    @Schema(name = "ReadingLineResultInput", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    record LineResultInput(
            @NotNull @JsonProperty("line_id") UUID lineId,
            @NotNull OutcomeInput outcome,
            @NotNull @PositiveOrZero Integer misses) {
    }

    /** passed 대조 통과 · unmatched 2회 미달 뒤 넘어감(read 는 1회) · skipped quiz 의 넘어가기. */
    @Schema(name = "ReadingLineOutcomeInput")
    enum OutcomeInput {
        passed,
        unmatched,
        skipped
    }

    /**
     * 회차 목록(R00.5)의 항목 하나.
     *
     * @param ordinal 그 대본에서 시작한 순(1부터, 집계)
     * @param myDialogueCount 구간 안 내 대사 수
     * @param recordedLineCount 녹음된 줄 수(reading.recording)
     */
    @Schema(name = "ReadingSessionCard", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record CardResponse(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) UUID id,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) int ordinal,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, implementation = ReadingSessionStatus.class) String status,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) List<UUID> myCharacterIds,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) List<String> myCharacterNames,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) RangeResponse range,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) int myDialogueCount,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) int recordedLineCount,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) int elapsedSeconds,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) Instant startedAt,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true) Instant endedAt) {
    }

    /** 구간 — 시작·끝 대사의 대사 번호(둘 다 포함). */
    @Schema(name = "ReadingSessionRange", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record RangeResponse(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) int startDialogueNo,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) int endDialogueNo) {
    }

    /**
     * 회차 상세. 시작 응답도 이 모양이다.
     *
     * @param currentLineId 다음에 할 대사 줄. completed 면 {@code null}, stopped 는 중단 위치
     * @param recordings 줄 순서의 녹음. 재생 주소는 녹음 기능이 채운다
     */
    @Schema(name = "ReadingSession", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record DetailResponse(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) UUID id,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) int ordinal,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, implementation = ReadingSessionStatus.class) String status,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) List<UUID> myCharacterIds,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) List<String> myCharacterNames,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) RangeResponse range,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) int myDialogueCount,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) int recordedLineCount,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) int elapsedSeconds,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) Instant startedAt,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true) Instant endedAt,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) UUID scriptId,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, implementation = ReadingMode.class) String mode,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, implementation = ReadingAdvance.class) String advance,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) boolean record,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) UUID startLineId,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) UUID endLineId,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true) UUID currentLineId,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) long progressSeq,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) List<LineResultResponse> lineResults,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) List<RecordingResponse> recordings) {
    }

    /** 줄마다 하나. 마지막 사건이 이긴다. */
    @Schema(name = "ReadingLineResult", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record LineResultResponse(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) UUID lineId,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, allowableValues = {"passed", "unmatched", "skipped"})
            String outcome,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) int misses) {
    }

    /** 회차 상세의 녹음 하나(reading.recording). 재생 주소(10분 서명)는 녹음 기능이 채우고 그 전에는 {@code null} 이다. */
    @Schema(name = "ReadingSessionRecording", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record RecordingResponse(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) UUID id,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) UUID lineId,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) int attemptNo,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) int durationMs,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String contentType,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) long byteSize,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true) String transcript,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, implementation = TranscriptSource.class)
            String transcriptSource,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true) Boolean matched,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true) String playbackUrl,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true) Instant playbackExpiresAt) {
    }

    /**
     * 녹음 올리기의 multipart 본문(OpenAPI 서술용 — 바인딩은 {@code RecordingController} 가 칸마다 직접 한다). {@code audio} 는
     * 파일이고 나머지는 글자 칸이다. {@code transcript}·{@code matched} 는 {@code transcript_source=stt} 일 때만 싣는다.
     */
    @Schema(name = "ReadingRecordingUploadForm")
    record UploadForm(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "기기가 만든 UUID. 같은 값은 같은 결과")
            @JsonProperty("request_id") UUID requestId,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "구간 안 내 대사 줄")
            @JsonProperty("line_id") UUID lineId,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "줄마다 1부터 1씩")
            @JsonProperty("attempt_no") Integer attemptNo,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, type = "string", format = "binary",
                    description = "음성 파일. m4a(AAC)가 아니면 서버가 변환한다")
            String audio,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "길이(밀리초, 0 이상)")
            @JsonProperty("duration_ms") Integer durationMs,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, allowableValues = {"stt", "none"})
            @JsonProperty("transcript_source") String transcriptSource,
            @Schema(nullable = true, description = "기기 STT 의 전사") String transcript,
            @Schema(nullable = true, description = "대조 결과. 인식 불가·무발화면 싣지 않는다") Boolean matched) {
    }

    /** 그 대본의 회차, 최근순. */
    @Schema(name = "ReadingSessionList", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    record ListResponse(@Schema(requiredMode = Schema.RequiredMode.REQUIRED) List<CardResponse> sessions) {
    }

    /** 진행 저장의 답 — 반영했든 무시했든 현재 값이다. */
    @Schema(name = "ReadingSessionProgress", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record ProgressResponse(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true) UUID currentLineId,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) int elapsedSeconds,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) long progressSeq,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, implementation = ReadingSessionStatus.class) String status) {
    }
}
