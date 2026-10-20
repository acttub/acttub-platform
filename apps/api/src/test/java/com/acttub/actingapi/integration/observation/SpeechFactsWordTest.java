package com.acttub.actingapi.integration.observation;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.List;

import org.junit.jupiter.api.Test;

/** 받아쓰기 단어의 시각은 유한하고 순서가 맞아야 하며, 음절이 없는 말은 빠르기를 매기지 않는다. */
class SpeechFactsWordTest {

    @Test
    void wordWithoutTextOrWithImpossibleTimesIsRejected() {
        for (Runnable invalid : List.<Runnable>of(
                () -> new SpeechFacts.Word(null, 0, 1),
                () -> new SpeechFacts.Word("가", Double.NaN, 1),
                () -> new SpeechFacts.Word("가", 0, Double.POSITIVE_INFINITY),
                () -> new SpeechFacts.Word("가", -0.1, 1),
                () -> new SpeechFacts.Word("가", 2, 1))) {
            assertThatThrownBy(invalid::run)
                    .isInstanceOf(IllegalArgumentException.class)
                    .hasMessage("invalid transcription word or timestamp");
        }
        assertThat(new SpeechFacts.Word("가", 1, 1).end()).isEqualTo(1.0);
    }

    @Test
    void speechWithoutSyllablesHasNoRelativePace() {
        SpeechAnalysis analysis = SpeechFacts.calculate("", List.of(new SpeechFacts.Word("", 0, 1.0)));

        assertThat(analysis.avgSyllablesPerSec()).isZero();
        assertThat(analysis.chunks()).singleElement().satisfies(chunk -> {
            assertThat(chunk.deltaPct()).isNull();
            assertThat(chunk.mark()).isNull();
        });
    }
}
