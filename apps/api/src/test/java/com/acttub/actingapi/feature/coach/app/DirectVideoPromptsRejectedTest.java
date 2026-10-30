package com.acttub.actingapi.feature.coach.app;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class DirectVideoPromptsRejectedTest {

    @Test
    void rejectedBlockNeedsTwoRejectionsAndListsDistinctDiagnoses() {
        PriorContext one = new PriorContext(Map.of("avoid", "- 설득보다 내 감정에 집중…: \"아닌데요\""), null, false, List.of(), List.of());
        assertThat(DirectVideoPrompts.rejectedBlock(one, null)).isEmpty();

        String avoid = String.join("\n",
                "- 설득보다 내 감정에 집중…: \"아닌데요\"",
                "- 설득보다 내 감정에 집중…: \"또 그 소리\"",
                "- 설득보다 답답함이 커 보여…: \"하나도 안답답해보이는데요\"");
        PriorContext three = new PriorContext(Map.of("avoid", avoid), null, false, List.of(), List.of());
        String block = DirectVideoPrompts.rejectedBlock(three, null);
        assertThat(block).contains("3번 아니라고 했다").contains("피한 진단:")
                .contains("- 설득보다 내 감정에 집중…").contains("- 설득보다 답답함이 커 보여…")
                .doesNotContain("{{");
        assertThat(block.split("- 설득보다 내 감정에 집중…", -1).length - 1).as("같은 진단은 한 번만").isEqualTo(1);
        assertThat(DirectVideoPrompts.rejectedBlock(three, java.util.Locale.ENGLISH)).isEmpty();
        assertThat(DirectVideoPrompts.rejectedBlock(PriorContext.EMPTY, null)).isEmpty();
    }
}
