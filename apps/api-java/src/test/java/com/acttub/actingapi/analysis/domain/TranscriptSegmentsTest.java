package com.acttub.actingapi.analysis.domain;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class TranscriptSegmentsTest {

    @Test
    void matchesPythonNewlineAndSentenceBoundaryRules() {
        assertThat(TranscriptSegments.fromText(
                "  첫째 대사예요.  다음이에요!\r\n\r\n"
                        + "전각입니다。 계속해요！ 마지막？\r"
                        + "  끝  "))
                .containsExactly(
                        "첫째 대사예요.",
                        "다음이에요!",
                        "전각입니다。",
                        "계속해요！",
                        "마지막？",
                        "끝");
    }
}
