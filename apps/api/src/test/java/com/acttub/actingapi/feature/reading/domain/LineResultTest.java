package com.acttub.actingapi.feature.reading.domain;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

class LineResultTest {
    private static final UUID FIRST = UUID.randomUUID();
    private static final UUID SECOND = UUID.randomUUID();
    private static final Map<UUID, String> TEXTS = Map.of(FIRST, "여기 있을 줄 알았어.", SECOND, "그럼 다 달라져.");

    @Test
    @DisplayName("reading.session: 말한 것을 보낸 줄은 서버가 원문과 비교한다 — 통과는 passed·0, 미달은 unmatched·1 이고 같은 말을 다시 보내도 같다")
    void saidIsJudgedOnceAndResendingConverges() {
        List<LineReport> reports = List.of(
                new LineReport.Said(FIRST, "여기 있을 줄 알았어"),
                new LineReport.Said(SECOND, "전혀 다른 말이야 이건"));

        List<LineResult> once = LineResult.merge(List.of(), reports, TEXTS);
        List<LineResult> twice = LineResult.merge(once, reports, TEXTS);

        assertThat(once).containsExactly(
                new LineResult(FIRST, "passed", 0, "여기 있을 줄 알았어"),
                new LineResult(SECOND, "unmatched", 1, "전혀 다른 말이야 이건"));
        assertThat(twice).isEqualTo(once);
    }

    @Test
    @DisplayName("reading.session: 말한 것이 결과보다 이긴다. 무발화·1,000자 초과는 넣지 않아 저장된 결과가 남는다. 결과만 보낸 줄은 말한 것이 없다")
    void saidWinsAndUnjudgedSpeechLeavesTheStoredResult() {
        List<LineResult> stored = List.of(new LineResult(FIRST, "unmatched", 1, "전혀 다른 말"));

        assertThat(LineResult.merge(stored, List.of(new LineReport.Said(FIRST, "  ...")), TEXTS)).isEqualTo(stored);
        assertThat(LineResult.merge(stored, List.of(new LineReport.Said(FIRST, "가".repeat(1001))), TEXTS)).isEqualTo(stored);
        assertThat(LineResult.merge(stored, List.of(new LineReport.Reported(FIRST, "skipped", 0)), TEXTS))
                .containsExactly(new LineResult(FIRST, "skipped", 0, null));
        assertThat(LineResult.merge(stored, List.of(new LineReport.Reported(SECOND, "passed", 2)), TEXTS))
                .containsExactly(stored.getFirst(), new LineResult(SECOND, "passed", 2, null));
    }
}
