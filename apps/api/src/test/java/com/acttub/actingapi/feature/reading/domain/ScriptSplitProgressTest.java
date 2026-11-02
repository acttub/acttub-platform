package com.acttub.actingapi.feature.reading.domain;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

class ScriptSplitProgressTest {

    @Test
    @DisplayName("구간 안의 자리는 센 만큼 비례하고, 셀 것이 없거나 넘치면 구간 끝, 모자라면 구간 시작이다")
    void betweenIsProportionalAndClamped() {
        assertThat(ScriptSplitProgress.between(35, 88, 0, 1776)).isEqualTo(35);
        assertThat(ScriptSplitProgress.between(35, 88, 888, 1776)).isEqualTo(61);
        assertThat(ScriptSplitProgress.between(35, 88, 1776, 1776)).isEqualTo(88);
        assertThat(ScriptSplitProgress.between(35, 88, 2000, 1776)).isEqualTo(88);
        assertThat(ScriptSplitProgress.between(35, 88, -3, 1776)).isEqualTo(35);
        assertThat(ScriptSplitProgress.between(8, 30, 0, 0)).isEqualTo(30);
    }

    @Test
    @DisplayName("구간 끝값은 나누기 순서대로 커지고 저장 전에는 100 에 닿지 않는다")
    void bandsGrowInOrderBelowHundred() {
        assertThat(new int[] {0, ScriptSplitProgress.SPACED, ScriptSplitProgress.PREPARED, ScriptSplitProgress.SPLIT,
                ScriptSplitProgress.FILLED, ScriptSplitProgress.REVIEWED, ScriptSplitProgress.MERGED, ScriptSplitProgress.SAVING, 100})
                .isSorted().doesNotHaveDuplicates();
    }
}
