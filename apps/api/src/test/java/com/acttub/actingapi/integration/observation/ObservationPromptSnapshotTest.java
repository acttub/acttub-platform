package com.acttub.actingapi.integration.observation;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Map;

import com.acttub.actingapi.support.FrozenValue;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * 관찰 프롬프트가 <b>한 글자도 바뀌지 않았는지</b> 확인한다.
 *
 * <p>이 층에서 가장 큰 것이 프롬프트 문자열이다. 공백·줄바꿈·조사 하나가 달라도 같은 영상에서
 * 다른 관찰이 나오는데, <b>그 차이는 어떤 스키마 검증으로도 잡히지 않는다.</b>
 *
 * <p>기대값은 {@code frozen/} 의 커밋된 fixture 다 — 왜 커밋해도 되는지는
 * {@link FrozenValue} 에 있다.
 */
class ObservationPromptSnapshotTest {

    /** blockage_kind 로 분기하므로 세 갈래를 전부 본다. */
    private static final Map<String, String> BY_BLOCKAGE_KIND = Map.of(
            "분석", "observation-prompt-analysis.txt",
            "표현", "observation-prompt-expression.txt",
            "그 외", "observation-prompt-other.txt");

    @Test
    @DisplayName("OBSERVATION_SYSTEM_PROMPT 가 동결된 값과 완전히 같다")
    void systemPromptMatchesFrozenValue() {
        assertThat(ObservationPrompt.SYSTEM)
                .as("시스템 프롬프트가 바뀌었다 — 공백·줄바꿈·조사까지 같아야 한다")
                .isEqualTo(FrozenValue.of("observation-system-prompt.txt"));
    }

    @Test
    @DisplayName("buildObservationPrompt 출력이 동결된 값과 완전히 같다")
    void observationPromptMatchesFrozenValue() {
        BY_BLOCKAGE_KIND.forEach((kind, fixture) -> {
            ActorMaterial material = new ActorMaterial(
                    "연습실에서 혼자 대사를 반복한다",
                    "오디션을 앞둔 지원자",
                    "담담해 보이려 한다",
                    kind,
                    "자꾸 빨라진다",
                    93000L);

            assertThat(ObservationPrompt.build(material))
                    .as("blockage_kind=%s 의 프롬프트가 바뀌었다", kind)
                    .isEqualTo(FrozenValue.of(fixture));
        });
    }
}
