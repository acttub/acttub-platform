package com.acttub.actingapi.feature.reading.domain;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * 회차 안 한 줄의 결과 (reading.session). 줄마다 하나이고 <b>마지막 사건이 이긴다</b>.
 *
 * <p>{@code outcome} 은 {@code passed}(대조 통과)·{@code unmatched}(2회 미달 뒤 넘어감, read 에서는 1회 미달)·
 * {@code skipped}(quiz 의 넘어가기)이고 {@code misses} 는 미달 횟수다. {@code said} 는 서버가 원문과 비교한 말한 것이고
 * 기기가 결과만 보낸 줄은 {@code null} 이다. 대조 결과는 판정 금지의 유일한 예외이며 점수·거리는 두지 않는다.
 */
public record LineResult(UUID lineId, String outcome, int misses, String said) {

    public static final String PASSED = "passed";
    public static final String UNMATCHED = "unmatched";
    public static final String SKIPPED = "skipped";

    /**
     * 기기가 보낸 것을 저장된 결과 위에 얹는다 — 같은 줄은 나중 것이 이기고, 보내지 않은 줄은 그대로 남는다. 순서는
     * 처음 나타난 순서다. 말한 것을 보낸 줄은 원문과 비교해 읽어주기 규칙으로 정한다(통과는 미달 0, 미달은 1 — 비교는 줄마다
     * 한 번이고, 같은 말을 다시 보내도 같은 결과다). 비교하지 않는 말(무발화·한도 초과)은 넣지 않는다.
     *
     * @param texts 보낸 줄의 원문
     */
    public static List<LineResult> merge(List<LineResult> stored, List<LineReport> incoming, Map<UUID, String> texts) {
        Map<UUID, LineResult> byLine = new LinkedHashMap<>();
        for (LineResult result : stored) {
            byLine.put(result.lineId(), result);
        }
        for (LineReport report : incoming) {
            LineResult result = switch (report) {
                case LineReport.Said said -> judge(said, texts.get(said.lineId()));
                case LineReport.Reported reported ->
                        new LineResult(reported.lineId(), reported.outcome(), reported.misses(), null);
            };
            if (result != null) {
                byLine.put(result.lineId(), result);
            }
        }
        return new ArrayList<>(byLine.values());
    }

    private static LineResult judge(LineReport.Said report, String target) {
        return switch (LineMatch.compare(report.said(), target)) {
            case PASS -> new LineResult(report.lineId(), PASSED, 0, report.said());
            case MISS -> new LineResult(report.lineId(), UNMATCHED, 1, report.said());
            case NO_SPEECH, TOO_LONG -> null;
        };
    }
}
