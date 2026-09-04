package com.acttub.actingapi.feature.memory.app;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import com.acttub.actingapi.support.FrozenValue;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * 기억 추출 프롬프트가 <b>한 글자도 바뀌지 않았는지</b> 확인한다.
 *
 * <p>이 프롬프트에는 동결 기대값이 없었다. 여기서 지어낸 값은 응답으로 끝나지 않고
 * {@code actor_memory_entries} 에 <b>저장되어</b> 다음 연습의 코치 프롬프트로 들어가므로
 * ({@code CoachPrompt:MEMORY_LABELS}), 거짓이 굳는 유일한 경로다.
 */
class MemoryExtractionPromptSnapshotTest {

    private static final UUID USER_ID = UUID.fromString("00000000-0000-0000-0000-000000000001");
    private static final UUID SESSION_ID = UUID.fromString("00000000-0000-0000-0000-000000000002");

    @Test
    @DisplayName("값이 다 있을 때의 출력이 동결된 값과 완전히 같다")
    void promptMatchesFrozenValue() {
        assertThat(MemoryExtractor.buildExtractionPrompt(
                material("담담하게 말한다", "대사 분석", "자꾸 빨라진다", List.of("이유를 모르겠어요")),
                Map.of()))
                .isEqualTo(FrozenValue.of("memory-extraction-prompt.txt"));
    }

    /**
     * 목표가 빈 칸이면 <b>줄 자체를 만들지 않고</b> 부재를 명시한다(ADR-021). 여기서 부재를
     * "장면을 적지 않았다" 로 적으면 거짓이다 — 이 프롬프트는 상황·캐릭터를 애초에 싣지
     * 않아 그 둘의 유무를 알지 못한다. 아는 것은 목표뿐이다.
     */
    @Test
    @DisplayName("목표가 비면 부재를 명시하고 '그 외' 는 특정하지 않음이 된다")
    void blankGoalStatesTheAbsence() {
        assertThat(MemoryExtractor.buildExtractionPrompt(
                material("", "그 외", "", List.of()), Map.of()))
                .isEqualTo(FrozenValue.of("memory-extraction-prompt-blank-goal.txt"));
    }

    /** 판정은 {@code isBlank()} 다 — 공백만 든 값도 배우가 적은 것이 아니다. */
    @Test
    @DisplayName("공백만 든 목표·상세도 빈 칸과 같게 다룬다")
    void whitespaceOnlyIsTreatedAsBlank() {
        assertThat(MemoryExtractor.buildExtractionPrompt(
                material(" ", "그 외", "\t", List.of()), Map.of()))
                .isEqualTo(FrozenValue.of("memory-extraction-prompt-blank-goal.txt"));
    }

    /**
     * 기억이 대사 복붙이 되던 사고(SOMA-468)의 재발 방지. "그대로 옮겨" 지시가
     * 있던 시절 운영 기억 칸이 전부 발화 원문 인용으로 채워졌다.
     */
    @Test
    @DisplayName("시스템 프롬프트는 요약을 시키고, 원문 통째 복사 지시가 없다")
    void systemPromptDemandsSummariesNotTranscripts() {
        assertThat(MemoryExtractor.SYSTEM_PROMPT)
                .contains("통째로 옮겨 적지 않는다")
                .contains("한 줄로 요약")
                .doesNotContain("그대로 옮겨");
    }

    private static MemoryUpdateMaterial material(
            String goal, String subBranch, String blockageDetail, List<String> actorMessages) {
        return new MemoryUpdateMaterial(
                USER_ID, SESSION_ID, goal, "분석", subBranch, blockageDetail,
                List.of("가지 마"), actorMessages);
    }
}
