package com.acttub.actingapi.feature.coach.app;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;

class PriorContextCoachGuessesTest {

    @Test
    void 직접_영상_코치에는_지난_코치의_짐작_칸을_넘기지_않는다() {
        Map<String, String> memory = new LinkedHashMap<>();
        memory.put("goal", "엄마가 나를 봐 주길 바란다");
        memory.put("habits", "혼자 감정에 빠져 대사를 읊는 모습이 관찰됐다");
        memory.put("blockage", "혼자 감정에 빠지는 지점에서 반복된다");
        memory.put("avoid", "- 상대를 안 본다는 진단");
        memory.put("speech_actual", "말이 빠르다");
        PriorContext prior = new PriorContext(memory, "지난 대화", false, List.of("달래 보기"), List.of());

        PriorContext kept = prior.withoutCoachGuesses();

        assertThat(kept.memory()).containsOnlyKeys("goal", "avoid");
        assertThat(kept.earlierConversation()).isEqualTo("지난 대화");
        assertThat(kept.pendingTakes()).containsExactly("달래 보기");
        String block = CoachPrompt.priorContextBlock(kept, true, false);
        assertThat(block).doesNotContain("혼자 감정에 빠지").contains("다시 꺼내지 않는다");
    }
}
