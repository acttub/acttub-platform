package com.acttub.actingapi.feature.challenge.app;

import static org.assertj.core.api.Assertions.assertThat;

import java.lang.reflect.RecordComponent;
import java.util.Arrays;
import org.junit.jupiter.api.Test;

/** challenge.ai-report: 입력은 영상과 챌린지 대사뿐이다 — 코치 대화·장면 입력·배우 기억이 실릴 자리가 없다. */
class ChallengeReportPromptTest {
    @Test void challengeAiReport_inputCarriesOnlyVideosAndTheLine() {
        assertThat(names(AiReportRepository.Material.class)).containsExactly("owner", "entryId", "line", "mine", "samples");
        assertThat(names(AiReportRepository.Video.class)).containsExactly("objectKey", "contentType", "durationMs");
        assertThat(names(AiReportRepository.Sample.class)).containsExactly("entryId", "video");
        String prompt = ChallengeReportPrompt.instruction("가지 마.", 5);
        assertThat(prompt).contains("가지 마.", "S1…S5", "점수", "다른 참여작들");
        assertThat(prompt).doesNotContain("기억", "코치", "장면 메모");
        assertThat(ChallengeReportPrompt.instruction("가지 마.", 0)).contains("comparisons 는 빈 배열");
    }

    private static String[] names(Class<?> type) {
        return Arrays.stream(type.getRecordComponents()).map(RecordComponent::getName).toArray(String[]::new);
    }
}
