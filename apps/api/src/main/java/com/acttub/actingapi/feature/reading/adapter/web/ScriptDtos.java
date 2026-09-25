package com.acttub.actingapi.feature.reading.adapter.web;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.platform.schema.ReadingSessionStatus;
import com.acttub.actingapi.platform.schema.ScriptLineKind;
import com.acttub.actingapi.platform.schema.ScriptSource;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;

final class ScriptDtos {
    private ScriptDtos() {
    }

    /**
     * 기기가 나눈 대본을 한 요청으로 보낸다. 줄의 {@code character_index} 는 {@code characters} 의 자리(0부터)이고
     * 대사 줄에만 있다. {@code ordinal} 은 1부터 배열 순서와 같다.
     */
    @Schema(name = "ReadingScriptCreateRequest", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    record CreateRequest(
            @NotNull @JsonProperty("request_id") UUID requestId,
            @NotNull @Schema(maxLength = 200) String title,
            @NotNull SourceInput source,
            @NotNull @JsonProperty("raw_text") String rawText,
            @NotNull @Valid List<@NotNull @Valid CharacterInput> characters,
            @NotNull @Valid List<@NotNull @Valid LineInput> lines) {
    }

    @Schema(name = "ReadingScriptCharacterInput", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    record CharacterInput(@NotNull String name) {
    }

    @Schema(name = "ReadingScriptLineInput", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    record LineInput(
            @NotNull Integer ordinal,
            @NotNull LineKindInput kind,
            @Schema(nullable = true) @JsonProperty("character_index") Integer characterIndex,
            @NotNull String text) {
    }

    /** 값 이름은 DB CHECK 값이자 API 값이다({@link ScriptSource}). */
    @Schema(name = "ReadingScriptSourceInput")
    enum SourceInput {
        file,
        paste,
        typed,
        sample
    }

    /** 값 이름은 DB CHECK 값이자 API 값이다({@link ScriptLineKind}). */
    @Schema(name = "ReadingScriptLineKindInput")
    enum LineKindInput {
        dialogue,
        direction,
        scene
    }

    /** 제목과 배역의 이름·목소리만 고친다. 보낸 항목만 바꾸고 줄은 받지 않는다. */
    @Schema(name = "ReadingScriptPatch", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    record PatchRequest(
            @Schema(nullable = true, maxLength = 200) String title,
            @Valid List<@NotNull @Valid CharacterPatchInput> characters) {
    }

    /**
     * 배역 하나의 수정. {@code voice_preset} 은 <b>키가 있을 때만</b> 바꾼다 — {@code null} 을 보내면 "자동"으로
     * 돌아가고, 키를 빼면 그대로다. 그래서 record 가 아니라 setter 가 있는 클래스다(있고 없음을 가른다).
     */
    @Schema(name = "ReadingScriptCharacterPatch", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    static final class CharacterPatchInput {
        private UUID id;
        private String name;
        private String voicePreset;
        private boolean voicePresetSet;

        @NotNull
        @Schema(requiredMode = Schema.RequiredMode.REQUIRED)
        public UUID getId() {
            return id;
        }

        @JsonProperty("id")
        public void setId(UUID id) {
            this.id = id;
        }

        @Schema(nullable = true)
        public String getName() {
            return name;
        }

        @JsonProperty("name")
        public void setName(String name) {
            this.name = name;
        }

        @Schema(nullable = true, maxLength = 32)
        @JsonProperty("voice_preset")
        public String getVoicePreset() {
            return voicePreset;
        }

        @JsonProperty("voice_preset")
        public void setVoicePreset(String voicePreset) {
            this.voicePreset = voicePreset;
            this.voicePresetSet = true;
        }

        @Schema(hidden = true)
        @com.fasterxml.jackson.annotation.JsonIgnore
        public boolean isVoicePresetSet() {
            return voicePresetSet;
        }
    }

    /** 대본 상세. 등록·수정도 이 모양을 돌려주고, 앱은 응답으로 화면을 덮는다. 원문은 싣지 않는다. */
    @Schema(name = "ReadingScript", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record ScriptResponse(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) UUID id,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String title,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, implementation = ScriptSource.class) String source,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) List<CharacterResponse> characters,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) List<LineResponse> lines,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) int recordingCount,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true) UUID openSessionId,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true) LastSessionResponse lastSession,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) Instant createdAt,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) Instant updatedAt) {
    }

    /** @param voicePreset 상대역 목소리 프리셋 id. {@code null} 이면 자동 */
    @Schema(name = "ReadingScriptCharacter", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record CharacterResponse(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) UUID id,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String name,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) int order,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true) String voicePreset,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) int dialogueCount) {
    }

    /** @param dialogueNo 대사 번호 — 대사 줄만 센 순번(1부터). 지문·장면은 {@code null} */
    @Schema(name = "ReadingScriptLine", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record LineResponse(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) UUID id,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) int ordinal,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, implementation = ScriptLineKind.class) String kind,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true) UUID characterId,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String text,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true) Integer dialogueNo) {
    }

    /** 대본 상세와 카드가 함께 보는 마지막 회차. */
    @Schema(name = "ReadingScriptLastSession", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record LastSessionResponse(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) UUID id,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, implementation = ReadingSessionStatus.class)
            String status,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) List<UUID> myCharacterIds,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) List<String> myCharacterNames,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) Instant startedAt,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true) Instant endedAt) {
    }

    /**
     * 목록의 카드 하나.
     *
     * @param myCharacterNames 마지막 회차의 내 배역. 회차가 없으면 비어 있다("배역 미선택")
     * @param lastPracticedAt 마지막 회차의 마지막 갱신 시각. 회차가 없으면 {@code null}("N월 N일 업로드")
     * @param status 상태 칩 — {@code reading} 연습 중 · {@code completed} 연습 완료 · {@code no_cast} 배역 선택
     */
    @Schema(name = "ReadingScriptCard", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record CardResponse(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) UUID id,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String title,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) List<String> myCharacterNames,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) int dialogueCount,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) int recordingCount,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true) Instant lastPracticedAt,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) Instant lastActivityAt,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, allowableValues = {"reading", "completed", "no_cast"})
            String status,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) Instant createdAt,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) Instant updatedAt) {
    }

    /**
     * @param totalCount 검색과 무관한 전체 대본 수 — 머리의 "전체 N개"
     * @param inProgressCount 열린 회차가 있는 대본 수 — 머리의 "연습 중 M개"
     */
    @Schema(name = "ReadingScriptList", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record ListResponse(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) List<CardResponse> scripts,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) int totalCount,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) int inProgressCount) {
    }
}
