package com.acttub.actingapi.feature.reading.domain;

import com.acttub.actingapi.platform.schema.CharacterAgeBand;
import com.acttub.actingapi.platform.schema.CharacterGender;

/**
 * 나누기 모델이 대본에서 읽은 배역의 성별·나이대 (reading.cast 「자동 목소리」, SOMA-670). 각 칸은 모르면 {@code null} 이다 —
 * 모델이 비웠거나 목록 밖 값을 쓴 것도 모름이다.
 */
public record CharacterTraits(CharacterGender gender, CharacterAgeBand ageBand) {

    public static final CharacterTraits UNKNOWN = new CharacterTraits(null, null);

    /** 모델이 쓴 두 칸에서. 목록 밖 값은 {@code null}. */
    public static CharacterTraits parse(String gender, String ageBand) {
        return new CharacterTraits(CharacterGender.of(gender), CharacterAgeBand.of(ageBand));
    }
}
