package com.acttub.actingapi.feature.reading.adapter.web;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.reading.app.ScriptCocreateService;
import com.acttub.actingapi.feature.reading.domain.CocreatedScript;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

/** 찍을 대사 같이 만들기의 요청·응답 (SOMA-721). 요청은 unknown key 를 거부한다. */
final class ScriptCocreateDtos {
    private ScriptCocreateDtos() {
    }

    @Schema(name = "SampleScriptExperience")
    enum ExperienceInput {
        beginner,
        exam,
        experienced
    }

    @Schema(name = "SampleScriptGender")
    enum GenderInput {
        female,
        male,
        unspecified
    }

    @Schema(name = "SampleScriptGoal")
    enum GoalInput {
        hobby,
        audition,
        professional
    }

    /**
     * @param emotion 비었거나 「잘 모르겠어요」면 서버가 고른다
     * @param situation 비었거나 「아무거나 좋아요」면 서버가 고른다
     * @param characterCount 내 배역 포함 1~4명. 1명은 독백. 기본 1
     * @param lengthMinutes 1·3·10분(추정치). 기본 1
     */
    @Schema(name = "SampleScriptCreateRequest", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record CreateRequest(
            @NotNull @Schema(requiredMode = Schema.RequiredMode.REQUIRED) UUID requestId,
            @Schema(nullable = true) ExperienceInput experience,
            @Min(5) @Max(120) @Schema(nullable = true) Integer age,
            @Schema(nullable = true) GenderInput gender,
            @Schema(nullable = true) GoalInput goal,
            @Size(max = 20) @Schema(nullable = true) String emotion,
            @Size(max = 200) @Schema(nullable = true) String situation,
            @Size(max = 300) @Schema(nullable = true) String direction,
            @Min(1) @Max(4) @Schema(nullable = true) Integer characterCount,
            @Schema(nullable = true, description = "1·3·10분") Integer lengthMinutes) {
    }

    /** @param text 비면 배역 수·분량만 바꾼다. 셋 다 그대로면 422 sample_script_no_change */
    @Schema(name = "SampleScriptRevisionRequest", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record RevisionRequest(
            @NotNull @Min(1) @Schema(requiredMode = Schema.RequiredMode.REQUIRED) Integer baseVersion,
            @Size(max = 500) @Schema(nullable = true) String text,
            @Min(1) @Max(4) @Schema(nullable = true) Integer characterCount,
            @Schema(nullable = true, description = "1·3·10분") Integer lengthMinutes) {
    }

    @Schema(name = "SampleScriptRestoreRequest", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record RestoreRequest(@NotNull @Min(1) @Schema(requiredMode = Schema.RequiredMode.REQUIRED) Integer version) {
    }

    @Schema(name = "SampleScriptCharacter", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record CharacterResponse(String name, String gender, String ageBand, boolean mine) {
    }

    /** @param character 대사의 배역 이름. 장면·지문은 {@code null} */
    @Schema(name = "SampleScriptLine", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record LineResponse(String kind, String character, String text) {
    }

    /** 설계도에서 장면 정보로 쓸 칸. */
    @Schema(name = "SampleScriptDesign", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record DesignResponse(String relation, String incident, String prop, String myObjective, String otherReason, String turnAction) {
    }

    /**
     * @param estimatedSeconds 대사 5자 = 1초로 어림한 낭독 시간. 실제 배우로 보정하지 않은 추정치다
     * @param revisionsLeft 남은 무료 수정
     * @param note 이 버전을 만든 수정의 한 줄 설명. 첫 버전은 {@code null}
     * @param scriptId 확정해 저장한 「내 대본」. 아직이면 {@code null}
     */
    @Schema(name = "SampleScript", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record SampleScriptResponse(
            UUID id,
            int version,
            int versionCount,
            String title,
            String scene,
            List<CharacterResponse> characters,
            List<LineResponse> lines,
            DesignResponse design,
            String emotion,
            String situation,
            int characterCount,
            int lengthMinutes,
            int estimatedSeconds,
            int revisionsUsed,
            int revisionsLeft,
            @Schema(nullable = true) String note,
            @Schema(nullable = true) UUID scriptId,
            Instant createdAt) {

        static SampleScriptResponse of(ScriptCocreateService.View view) {
            CocreatedScript script = view.script();
            CocreatedScript.Design d = script.design();
            return new SampleScriptResponse(view.id(), view.version(), view.versionCount(), script.title(), script.scene(),
                    script.characters().stream()
                            .map(role -> new CharacterResponse(role.name(), role.gender(), role.ageBand(), role.mine()))
                            .toList(),
                    script.lines().stream().map(line -> new LineResponse(line.kind(), line.character(), line.text())).toList(),
                    new DesignResponse(d.relation(), d.incident(), d.prop(), d.myObjective(), d.otherReason(), d.turnAction()),
                    view.emotion(), view.situation(), view.characterCount(), view.minutes(), view.estimatedSeconds(),
                    view.revisionsUsed(), view.revisionsLeft(), view.note(), view.scriptId(), view.createdAt());
        }
    }

    @Schema(name = "SampleScriptSaved", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record SavedResponse(UUID id, UUID scriptId) {
    }
}
