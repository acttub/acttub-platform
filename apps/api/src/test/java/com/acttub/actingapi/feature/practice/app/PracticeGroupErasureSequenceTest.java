package com.acttub.actingapi.feature.practice.app;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.EnumSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * 연습 삭제가 다른 기능의 기록을 정리하는 순서({@link PracticeGroupErasureSequence})가 적힌 그대로 도는지 본다. DB 없이 가짜
 * 구현으로 본다 — 실제 문장의 순서는 {@code AccountLifecycleFreezeIT} 의 연습 삭제 장면이 고정한다.
 */
class PracticeGroupErasureSequenceTest {

    private static final UUID ROOT = UUID.fromString("00000000-0000-4000-8000-000000000002");
    private static final ErasedPracticeGroup GROUP = new ErasedPracticeGroup(
            UUID.fromString("00000000-0000-4000-8000-000000000001"),
            ROOT,
            List.of(ROOT),
            UUID.fromString("00000000-0000-4000-8000-000000000003"),
            Instant.parse("2026-11-20T03:00:00Z"));

    private final List<String> calls = new ArrayList<>();

    @Test
    @DisplayName("PracticeGroupErasureStep 에 적힌 순서대로 부른다. 구현을 넘긴 순서는 쓰지 않는다")
    void erasesInTheWrittenOrderWhateverOrderThePartsArrive() {
        PracticeGroupErasureStep[] steps = PracticeGroupErasureStep.values();
        // 뒤 절반을 맡은 구현을 먼저 넘긴다.
        PracticeGroupErasurePart late = part("뒤", EnumSet.copyOf(Arrays.asList(steps).subList(steps.length / 2, steps.length)));
        PracticeGroupErasurePart early = part("앞", EnumSet.copyOf(Arrays.asList(steps).subList(0, steps.length / 2)));

        new PracticeGroupErasureSequence(List.of(late, early)).erase(GROUP);

        assertThat(calls).containsExactlyElementsOf(Arrays.stream(steps)
                .map(step -> (step.ordinal() < steps.length / 2 ? "앞" : "뒤") + ":" + step)
                .toList());
    }

    @Test
    @DisplayName("맡은 구현이 없는 자리가 있으면 만들 때 실패한다")
    void aStepWithoutAnOwnerFailsAtConstruction() {
        Set<PracticeGroupErasureStep> allButOne = EnumSet.complementOf(EnumSet.of(PracticeGroupErasureStep.ACTOR_MEMORIES));

        assertThatThrownBy(() -> new PracticeGroupErasureSequence(List.of(part("하나 빠짐", allButOne))))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("without an owner")
                .hasMessageContaining("ACTOR_MEMORIES");
        assertThatThrownBy(() -> new PracticeGroupErasureSequence(List.of()))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("without an owner");
    }

    @Test
    @DisplayName("한 자리를 두 구현이 맡으면 만들 때 실패한다")
    void aStepWithTwoOwnersFailsAtConstruction() {
        assertThatThrownBy(() -> new PracticeGroupErasureSequence(List.of(
                part("모두", EnumSet.allOf(PracticeGroupErasureStep.class)),
                part("겹침", EnumSet.of(PracticeGroupErasureStep.AI_JOBS)))))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("two owners")
                .hasMessageContaining("AI_JOBS");
    }

    private PracticeGroupErasurePart part(String name, Set<PracticeGroupErasureStep> steps) {
        return new PracticeGroupErasurePart() {
            @Override
            public Set<PracticeGroupErasureStep> steps() {
                return steps;
            }

            @Override
            public void erase(PracticeGroupErasureStep step, ErasedPracticeGroup group) {
                assertThat(group).isSameAs(GROUP);
                calls.add(name + ":" + step);
            }
        };
    }
}
