package com.acttub.actingapi.feature.practice.domain;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.UUID;

import org.junit.jupiter.api.Test;

/** practice.start: 빈 입력을 무엇으로 저장하는지와, 막힘 갈래·하위 갈래 조합 판정. */
class PracticeRulesTest {
    @Test void blankInputsBecomeTheirStoredDefaults() {
        assertThat(PracticeRules.scene(null)).isEmpty();
        assertThat(PracticeRules.scene("  ")).isEmpty();
        assertThat(PracticeRules.scene("문 앞")).isEqualTo("문 앞");
        assertThat(PracticeRules.blockage(null)).isEqualTo("그 외");
        assertThat(PracticeRules.blockage(" ")).isEqualTo("그 외");
        assertThat(PracticeRules.blockage("표현")).isEqualTo("표현");
        assertThat(PracticeRules.title(null)).isNull();
        assertThat(PracticeRules.title(" ")).isNull();
        assertThat(PracticeRules.title("  1차 ")).isEqualTo("1차");
        assertThat(PracticeRules.note(null)).isNull();
        assertThat(PracticeRules.note("\t")).isNull();
        assertThat(PracticeRules.note(" 빨라져요 ")).isEqualTo(" 빨라져요 ");
    }

    @Test void subBranchesMustBelongToTheirBlockageKind() {
        assertThat(BlockageBranch.pairs(null, "감정")).isTrue();
        assertThat(BlockageBranch.pairs("표현", null)).isTrue();
        assertThat(BlockageBranch.pairs("모름", "감정")).as("모르는 갈래는 값 하나짜리 검사가 답한다").isTrue();
        assertThat(BlockageBranch.pairs("표현", "감정")).isTrue();
        assertThat(BlockageBranch.pairs("분석", "감정")).isFalse();
        assertThat(BlockageBranch.pairs("그 외", "그 외")).isTrue();
    }

    @Test void anObservationPackWithoutRowsHasEmptyLists() {
        ObservationPack pack = new ObservationPack(UUID.randomUUID(), null, null);
        assertThat(pack.observations()).isEmpty();
        assertThat(pack.uncertainties()).isEmpty();
    }
}
