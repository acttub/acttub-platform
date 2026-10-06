package com.acttub.actingapi.feature.reading.domain;

import java.util.ArrayList;
import java.util.List;

/**
 * 상대역 목소리 (reading.cast). 배역마다 「내 배역이 아닐 때 읽을 목소리」를 정한다. 대본의 모든 배역을 저장 순서로
 * 세워 자동 순환을 돌리므로 어느 배역으로 연습하든 같은 배역은 같은 목소리다.
 *
 * <p>저장값은 32자 이내 아무 문자열이지만(ScriptRules), 기기에 내장된 프리셋이 아니면 자동으로 다룬다 — 기기가
 * 읽을 수 없는 값이라서다.
 */
public final class VoiceAssignment {

    /** 남녀가 번갈아 나오게 섞은 자동 순서. 기기 프리셋 전부이기도 하다. */
    private static final List<String> AUTO_ROTATION = List.of("F1", "M1", "F2", "M2", "F3", "M3", "F4", "M4", "F5", "M5");

    private VoiceAssignment() {
    }

    /**
     * @param presets 배역의 저장된 프리셋, 저장 순서대로. {@code null} 은 자동
     * @return 같은 순서의 목소리. 프리셋이면 그 값, 아니면 고정값을 뺀 자동 순환의 다음 값
     */
    public static List<String> voices(List<String> presets) {
        List<String> voices = new ArrayList<>(presets.size());
        int auto = 0;
        for (String preset : presets) {
            boolean known = preset != null && AUTO_ROTATION.contains(preset);
            voices.add(known ? preset : AUTO_ROTATION.get(auto++ % AUTO_ROTATION.size()));
        }
        return voices;
    }
}
