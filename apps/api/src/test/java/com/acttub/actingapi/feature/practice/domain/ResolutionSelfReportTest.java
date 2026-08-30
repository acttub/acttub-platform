package com.acttub.actingapi.feature.practice.domain;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

class ResolutionSelfReportTest {

    @Test
    @DisplayName("세 값만 받고 나머지는 null 이다 — 허용 목록은 CHECK 제약과 같다")
    void parsesOnlyTheThreeValues() {
        assertThat(ResolutionSelfReport.parse("resolved")).isEqualTo(ResolutionSelfReport.RESOLVED);
        assertThat(ResolutionSelfReport.parse("partly")).isEqualTo(ResolutionSelfReport.PARTLY);
        assertThat(ResolutionSelfReport.parse("same")).isEqualTo(ResolutionSelfReport.SAME);
        assertThat(ResolutionSelfReport.parse("better")).isNull();
        assertThat(ResolutionSelfReport.parse(null)).isNull();
        assertThat(ResolutionSelfReport.VALUES).containsExactly("resolved", "partly", "same");
    }

    @Test
    @DisplayName("배우에게 보이는 말은 판정 어휘가 아니라 배우 상태의 표현이다")
    void labelsAreActorStateNotJudgment() {
        assertThat(ResolutionSelfReport.RESOLVED.label()).isEqualTo("풀렸다");
        assertThat(ResolutionSelfReport.PARTLY.label()).isEqualTo("조금 풀렸다");
        assertThat(ResolutionSelfReport.SAME.label()).isEqualTo("그대로");
        assertThat(ResolutionSelfReport.labelOf("partly")).isEqualTo("조금 풀렸다");
        assertThat(ResolutionSelfReport.labelOf(null)).isNull();
    }
}
