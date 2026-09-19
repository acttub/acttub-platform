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

    /**
     * 완성된 프로필이 있으면 모델에 넘기는 기억 <b>사본</b>에서 성별·나이를 뺀다. 원본은 그대로다 —
     * 저장된 기억을 고치는 것이 아니다.
     */
    @Test
    @DisplayName("account.profile: 성별·나이를 뺀 사본은 목표와 나머지를 그대로 두고 원본을 바꾸지 않는다")
    void withoutDemographicsKeepsEverythingElseAndLeavesTheOriginalAlone() {
        PriorContext prior = new PriorContext(
                Map.of("gender", "남", "age", "31", "goal", "입시 합격", "blockage", "대사 분석"),
                "지난 대화", false, List.of("한 박자 쉬기"), List.of("1차: 호흡"));

        PriorContext forModel = prior.withoutDemographics();

        assertThat(forModel.memory()).containsOnlyKeys("goal", "blockage")
                .containsEntry("goal", "입시 합격");
        assertThat(forModel.earlierConversation()).isEqualTo("지난 대화");
        assertThat(forModel.fromSamePractice()).isFalse();
        assertThat(forModel.pendingTakes()).containsExactly("한 박자 쉬기");
        assertThat(forModel.sceneHistory()).containsExactly("1차: 호흡");
        assertThat(prior.memory()).containsKeys("gender", "age");
    }

    @Test
    @DisplayName("account.profile: 프로필이 없는 세션은 기억을 그대로 모델에 넘긴다")
    void sessionWithoutAProfileHandsTheMemoryOverUntouched() {
        PriorContext prior = new PriorContext(Map.of("gender", "남", "age", "31"), null, true, List.of(), List.of());
        CoachSessionSnapshot session = new CoachSessionSnapshot(
                java.util.UUID.randomUUID(), java.util.UUID.randomUUID(), java.util.UUID.randomUUID(),
                java.util.UUID.randomUUID(), null, "", "", "", 1000, "그 외", "그 외", null,
                List.of(), "", null, "open", "", List.of(), prior);

        assertThat(session.priorForModel()).isSameAs(prior);
        assertThat(session.withActorProfile(new ActorProfile("김배우", "여성", 25, List.of("매체(TV·영화)"), "입시생", "취미"))
                .priorForModel().isEmpty()).isTrue();
    }
}
