package com.acttub.actingapi.feature.analysis.app;

import static org.assertj.core.api.Assertions.assertThat;

import com.acttub.actingapi.support.FrozenValue;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * 받아쓰기 시스템 프롬프트가 바뀌지 않았는지 확인한다. 기대값은 {@code frozen/} 의 커밋된
 * fixture 이고, 왜 커밋해도 되는지는 {@link FrozenValue} 에 있다.
 */
class TranscriptionPromptSnapshotTest {

    @Test
    @DisplayName("TRANSCRIPTION_SYSTEM_PROMPT 가 동결된 값과 완전히 같다")
    void promptMatchesFrozenValueByteForByte() {
        assertThat(SummaryAnalyzer.TRANSCRIPTION_SYSTEM_PROMPT)
                .isEqualTo(FrozenValue.of("transcription-system-prompt.txt"));
    }
}
