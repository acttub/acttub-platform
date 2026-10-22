package com.acttub.actingapi.feature.memory.domain;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

/** 배우가 아니라 화면 선택이나 코치의 진행을 적은 값은 버린다 (SOMA-795). */
class MeaningfulMemoryValueTest {

    @Test
    void valuesThatDescribeTheSelectionScreenAreRejected() {
        // 2026-10-22 운영 기억에 실제로 있던 값.
        assertThat(MeaningfulMemoryValue.problem("blockage",
                "복합적인 감정을 소리 지르지 않고 표현하는 가운데, 표현과 표정에서 막히는 지점을 골랐다."))
                .contains("화면 선택을 설명함");
        assertThat(MeaningfulMemoryValue.problem("blockage", "배우가 고른 막히는 지점은 감정 표현이다")).isPresent();
    }

    @Test
    void valuesThatDescribeTheCoachsProcessAreRejected() {
        assertThat(MeaningfulMemoryValue.problem("habits", "시선 처리에 대한 지적이 있었고 배우가 받아들였다"))
                .contains("코치의 진행을 설명함");
        assertThat(MeaningfulMemoryValue.problem("tone", "코치가 이유를 물었고 배우는 짧게 답했다")).isPresent();
        assertThat(MeaningfulMemoryValue.problem("wants", "이번 연습에서는 대사 속도를 다뤘다")).isPresent();
    }

    @Test
    void tooShortOrAbsentValuesAreRejected() {
        assertThat(MeaningfulMemoryValue.problem("goal", "합격")).contains("너무 짧음");
        assertThat(MeaningfulMemoryValue.problem("blockage", "이번에는 특정되지 않았다")).contains("없다는 말");
        assertThat(MeaningfulMemoryValue.problem("goal", "없음 (배우가 적지 않음)")).isPresent();
    }

    @Test
    void valuesAboutTheActorPass() {
        assertThat(MeaningfulMemoryValue.problem("goal", "아버지에게 인정받고 싶은 마음을 숨긴 채 버틴다")).isEmpty();
        assertThat(MeaningfulMemoryValue.problem("wants", "코치가 방법을 바로 알려 주길 바란다(\"어떻게 해요?\")")).isEmpty();
        assertThat(MeaningfulMemoryValue.problem("tone", "답이 짧고 존댓말이며 직설적인 평가를 바란다")).isEmpty();
        assertThat(MeaningfulMemoryValue.problem("habits", "일부러 한 선택: 끝 대사를 낮게 눌렀다(\"화를 참는 거예요\")")).isEmpty();
    }
}
