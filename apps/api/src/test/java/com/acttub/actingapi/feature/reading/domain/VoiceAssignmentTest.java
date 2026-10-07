package com.acttub.actingapi.feature.reading.domain;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Arrays;
import java.util.Collections;
import java.util.List;

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

    private static List<String> presets(String... values) {
        return Arrays.asList(values);
    }
}
