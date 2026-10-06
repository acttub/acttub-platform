package com.acttub.actingapi.feature.reading.domain;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.UUID;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * 앱 {@code apps/mobile/tests/reading-session-results.test.mjs} 의 「원문과 다르게 말한 대사」 입력·기대값을 옮겼다. 앱
 * 픽스처의 줄 l0~l6 가운데 지문(l0·l3)은 서버 구간에 들지 않아 대사 줄 다섯만 남는다.
 */
class DifferentLineTest {
    private static final UUID L1 = UUID.randomUUID();
    private static final UUID L2 = UUID.randomUUID();
    private static final UUID L4 = UUID.randomUUID();
    private static final UUID L5 = UUID.randomUUID();
    private static final UUID L6 = UUID.randomUUID();
    private static final List<DifferentLine.Dialogue> LINES = List.of(
            new DifferentLine.Dialogue(L1, 1, "하나"),
            new DifferentLine.Dialogue(L2, 2, "둘"),
            new DifferentLine.Dialogue(L4, 3, "셋"),
            new DifferentLine.Dialogue(L5, 4, "넷"),
            new DifferentLine.Dialogue(L6, 5, "다섯"));
    private static final List<LineResult> RESULTS = List.of(
            new LineResult(L1, LineResult.PASSED, 0, "하나"),
            new LineResult(L4, LineResult.UNMATCHED, 1, "세엣"),
            new LineResult(L6, LineResult.UNMATCHED, 1, null));

    @Test
    @DisplayName("reading.session: 원문과 다르게 말한 대사는 구간 안 unmatched 인 줄이고 대사 번호·말한 것·어절을 줄 순서로 준다")
    void unmatchedLinesInRangeInLineOrder() {
        assertThat(DifferentLine.of(LINES, RESULTS)).containsExactly(
                new DifferentLine(L4, 3, "세엣", List.of(new WordDiff.Word("셋", true))),
                new DifferentLine(L6, 5, null, List.of(new WordDiff.Word("다섯", false))));
        assertThat(DifferentLine.of(LINES.subList(0, 3), RESULTS)).as("구간 밖은 뺀다")
                .extracting(DifferentLine::lineId).containsExactly(L4);
        assertThat(DifferentLine.of(LINES, RESULTS.subList(0, 1))).as("통과만 있으면 비어 있다").isEmpty();
    }
}
