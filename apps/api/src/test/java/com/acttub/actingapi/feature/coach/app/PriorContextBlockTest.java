package com.acttub.actingapi.feature.coach.app;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * 기억 블록에 억제 지시만 있으면 모델이 기억 언급 자체를 회피한다(SOMA-468 관찰).
 * 억제(그대로 읊지 않기)와 활용(한 번은 이어받기)이 함께 있어야 한다.
 */
class PriorContextBlockTest {

    @Test
    @DisplayName("기억 블록에는 억제와 활용 지시가 함께 실린다")
    void memoryBlockCarriesBothSuppressionAndUsage() {
        PriorContext prior = new PriorContext(
                Map.of("goal", "입시 합격"), null, true, List.of(), List.of());

        String block = CoachPrompt.priorContextBlock(prior);

        assertThat(block)
                .contains("배우가 말한 목표: 입시 합격")
                .contains("그대로 읊지 않는다")
                .contains("이어받아라");
    }

    @Test
    @DisplayName("지난 것이 하나도 없으면 블록 자체가 없다 — 빈 제목은 지어냄을 부른다")
    void emptyPriorMakesNoBlock() {
        assertThat(CoachPrompt.priorContextBlock(PriorContext.EMPTY)).isEmpty();
    }
}
