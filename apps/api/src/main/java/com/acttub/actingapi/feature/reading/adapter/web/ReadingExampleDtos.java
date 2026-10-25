package com.acttub.actingapi.feature.reading.adapter.web;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import com.acttub.actingapi.feature.reading.app.ReadingExampleService;
import com.acttub.actingapi.feature.reading.domain.ReadingExample;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotNull;

final class ReadingExampleDtos {
    private ReadingExampleDtos() {
    }

    @Schema(name = "ReadingExampleList", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    record ListResponse(@Schema(requiredMode = Schema.RequiredMode.REQUIRED) List<ExampleResponse> examples) {
        static ListResponse of(List<ReadingExample> examples) {
            return new ListResponse(examples.stream().map(ExampleResponse::of).toList());
        }
    }

    /** 예시 한 편. {@code preview} 는 앞 5줄까지(지문·장면은 {@code speaker} 가 null). */
    @Schema(name = "ReadingExample", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record ExampleResponse(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String id,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String title,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String summary,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) int dialogueCount,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) List<String> characters,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) List<PreviewLine> preview) {
        static ExampleResponse of(ReadingExample example) {
            return new ExampleResponse(example.id(), example.title(), example.summary(), example.dialogueCount(),
                    example.characters(), example.preview().stream().map(p -> new PreviewLine(p.speaker(), p.text())).toList());
        }
    }

    @Schema(name = "ReadingExamplePreviewLine", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    record PreviewLine(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true) String speaker,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String text) {
    }

    @Schema(name = "ReadingExampleStartRequest", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record StartRequest(@NotNull UUID requestId) {
    }

    /** 복사한(또는 이미 있던) 내 대본. {@code created} 가 false 면 같은 글의 대본이 이미 있었다. */
    @Schema(name = "ReadingExampleStarted", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record StartedResponse(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) UUID scriptId,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) boolean created) {
    }

    /** 예시를 복사한 대본의 미리 만든 상대역 음성. {@code voices} 는 배역 이름 → 음성을 만든 프리셋, {@code lines} 는 이은 대사 줄만. */
    @Schema(name = "ReadingExampleAudio", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record AudioResponse(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String exampleId,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) Map<String, String> voices,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) List<AudioLineResponse> lines) {
        static AudioResponse of(ReadingExampleService.ExampleAudio audio) {
            return new AudioResponse(audio.exampleId(), audio.voices(),
                    audio.lines().stream().map(l -> new AudioLineResponse(l.lineId(), l.url(), l.durationMs())).toList());
        }
    }

    @Schema(name = "ReadingExampleAudioLine", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record AudioLineResponse(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) UUID lineId,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String url,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) int durationMs) {
    }
}
