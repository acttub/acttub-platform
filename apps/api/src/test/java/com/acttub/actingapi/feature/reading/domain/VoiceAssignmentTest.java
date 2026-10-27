package com.acttub.actingapi.feature.reading.domain;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Arrays;
import java.util.Collections;
import java.util.List;

import com.acttub.actingapi.feature.reading.domain.VoiceAssignment.Cast;
import com.acttub.actingapi.platform.schema.CharacterAgeBand;
import com.acttub.actingapi.platform.schema.CharacterGender;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * 입력과 기대값은 앱 {@code tests/reading-voices.test.mjs} 와 같다. 앱의 {@code assignVoices(characters, mine)} 은
 * 서버 목록에서 내 배역 자리를 뺀 것이다 — 서버는 모든 배역의 목소리를 주고, 내 배역을 빼는 것은 기기다.
 */
class VoiceAssignmentTest {

    @Test
    @DisplayName("reading.cast: 자동 목소리는 대본의 모든 배역에 배역 순서로 F1·M1·F2·M2를 돌려 주고 내 배역만 뺀다")
    void autoVoicesRotateInCharacterOrder() {
        assertThat(VoiceAssignment.voices(presets(null, null, null, null))).containsExactly("F1", "M1", "F2", "M2");
    }

    @Test
    @DisplayName("reading.cast: \"니나\"를 M3으로 바꾸면 니나는 M3, 나머지는 자동 순환이고 다른 배역의 값은 그대로다")
    void aFixedPresetLeavesTheRotation() {
        assertThat(VoiceAssignment.voices(presets("M3", null, null))).containsExactly("M3", "F1", "M1");
    }

    @Test
    @DisplayName("reading.cast: 기기가 모르는 프리셋 값은 자동으로 다루고, 같은 프리셋을 두 배역에 줄 수 있다")
    void unknownPresetsAreAutoAndPresetsMayRepeat() {
        assertThat(VoiceAssignment.voices(presets("ELEVEN", "M2", "M2"))).containsExactly("F1", "M2", "M2");
    }

    @Test
    @DisplayName("reading.cast: 목소리 시트의 「자동 (지금 X)」 — 그 배역을 자동으로 돌리면 받을 목소리")
    void theVoiceACharacterWouldGetOnAuto() {
        assertThat(VoiceAssignment.voices(presets(null, null, null, null)).get(1))
                .as("고정값을 풀면 배역 순서 둘째 자리 목소리").isEqualTo("M1");
        assertThat(VoiceAssignment.voices(presets(null, "F3", null, null)).get(3))
                .as("고정값은 순환에서 빠지니 소린은 넷째(M2)가 아니라 셋째(F2) 자리").isEqualTo("F2");
    }

    @Test
    @DisplayName("reading.cast: 자동 배역이 열 하나면 열한째는 F1로 돌아간다")
    void theRotationWrapsAfterTenPresets() {
        assertThat(VoiceAssignment.voices(Collections.nCopies(11, null)))
                .containsExactly("F1", "M1", "F2", "M2", "F3", "M3", "F4", "M4", "F5", "M5", "F1");
    }

    @Test
    @DisplayName("SOMA-670: 성별·나이대를 아는 자동 배역은 그 선호 목록의 첫 프리셋을 받는다")
    void genderAndAgePickTheFirstPreferredPreset() {
        assertThat(VoiceAssignment.assign(List.of(
                auto(M, CharacterAgeBand.ADULT), auto(F, CharacterAgeBand.YOUNG), auto(M, CharacterAgeBand.SENIOR),
                auto(F, CharacterAgeBand.SENIOR), auto(M, CharacterAgeBand.YOUNG), auto(F, CharacterAgeBand.ADULT))))
                .containsExactly("M3", "F2", "M5", "F5", "M1", "F1");
    }

    @Test
    @DisplayName("SOMA-670: 어린이는 청년과 같은 목록이고, 나이대를 모르면 성별의 기본 목록이다")
    void childUsesTheYoungListAndUnknownAgeUsesTheDefaultList() {
        assertThat(VoiceAssignment.assign(List.of(auto(M, CharacterAgeBand.CHILD), auto(F, CharacterAgeBand.CHILD))))
                .containsExactly("M1", "F2");
        assertThat(VoiceAssignment.assign(List.of(auto(M, null), auto(F, null), auto(M, null), auto(F, null))))
                .containsExactly("M1", "F1", "M3", "F2");
    }

    @Test
    @DisplayName("SOMA-670: 같은 대본에서 이미 쓴 프리셋은 건너뛰고, 고정한 프리셋도 쓴 것으로 센다")
    void usedAndPinnedPresetsAreSkipped() {
        assertThat(VoiceAssignment.assign(List.of(auto(M, CharacterAgeBand.ADULT), auto(M, CharacterAgeBand.ADULT))))
                .containsExactly("M3", "M4");
        assertThat(VoiceAssignment.assign(List.of(auto(M, CharacterAgeBand.ADULT), pinned("M3"))))
                .as("고정값은 뒤에 있어도 먼저 쓴 것으로 센다").containsExactly("M4", "M3");
    }

    @Test
    @DisplayName("SOMA-670: 그 성별 프리셋을 다 쓰면 목록의 첫 값을 다시 쓴다")
    void exhaustedGenderFallsBackToTheFirstOfItsList() {
        assertThat(VoiceAssignment.assign(Collections.nCopies(6, auto(M, CharacterAgeBand.ADULT))))
                .containsExactly("M3", "M4", "M2", "M1", "M5", "M3");
        assertThat(VoiceAssignment.assign(List.of(pinned("F1"), pinned("F2"), pinned("F3"), pinned("F4"), pinned("F5"),
                auto(F, CharacterAgeBand.SENIOR)))).last().isEqualTo("F5");
    }

    @Test
    @DisplayName("SOMA-670: 성별을 모르는 배역은 F1·M1·F2·M2 순환을 돌되 이미 쓴 프리셋은 건너뛴다")
    void unknownGenderRotatesAndSkipsUsedPresets() {
        assertThat(VoiceAssignment.assign(List.of(auto(M, CharacterAgeBand.YOUNG), auto(null, null), auto(null, null))))
                .containsExactly("M1", "F1", "F2");
        assertThat(VoiceAssignment.assign(List.of(auto(null, null), auto(null, null), auto(F, null))))
                .as("순환이 가져간 F1 을 성별 목록도 건너뛴다(SOMA-912: 여자가 하나라 첫 모름 배역은 남자)").containsExactly("M1", "F1", "F2");
        assertThat(VoiceAssignment.assign(List.of(pinned("M1"), auto(null, CharacterAgeBand.ADULT), auto(null, null))))
                .as("나이대만 알면 성별을 모르는 것과 같다").containsExactly("M1", "F1", "F2");
    }

    @Test
    @DisplayName("SOMA-670: 순환도 다 쓰면 건너뛰지 않고 순환 자리의 값을 다시 쓴다")
    void unknownGenderRepeatsTheRotationWhenEverythingIsUsed() {
        List<Cast> cast = new java.util.ArrayList<>();
        for (String preset : List.of("F1", "M1", "F2", "M2", "F3", "M3", "F4", "M4", "F5", "M5")) {
            cast.add(pinned(preset));
        }
        cast.add(auto(null, null));
        cast.add(auto(null, null));
        assertThat(VoiceAssignment.assign(cast).subList(10, 12)).containsExactly("F1", "M1");
    }

    @Test
    @DisplayName("SOMA-670: 기기가 모르는 고정값은 쓴 것으로 세지 않고 그 배역은 자동이다")
    void unknownPinnedValuesAreAutoAndNotCounted() {
        assertThat(VoiceAssignment.assign(List.of(new Cast("ELEVEN", M, CharacterAgeBand.ADULT), auto(M, CharacterAgeBand.ADULT))))
                .containsExactly("M3", "M4");
    }

    private static final CharacterGender M = CharacterGender.MALE;
    private static final CharacterGender F = CharacterGender.FEMALE;

    private static Cast auto(CharacterGender gender, CharacterAgeBand ageBand) {
        return new Cast(null, gender, ageBand);
    }

    private static Cast pinned(String preset) {
        return new Cast(preset, null, null);
    }

    @Test
    @DisplayName("SOMA-912: 여자 둘과 성별 모를 배역 하나면 그 배역은 남자 목소리다")
    void unknownGenderTakesTheFewerGender() {
        assertThat(VoiceAssignment.assign(List.of(auto(F, CharacterAgeBand.SENIOR), auto(F, CharacterAgeBand.YOUNG),
                new VoiceAssignment.Cast(null, null, null)))).containsExactly("F5", "F2", "M1");
        assertThat(VoiceAssignment.assign(List.of(auto(M, CharacterAgeBand.ADULT), auto(M, null),
                new VoiceAssignment.Cast(null, null, null)))).containsExactly("M3", "M1", "F1");
    }

    private static List<String> presets(String... values) {
        return Arrays.asList(values);
    }
}
