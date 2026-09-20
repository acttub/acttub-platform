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
 * {@code skipped}(quiz 의 넘어가기)이고 {@code misses} 는 미달 횟수다. 다시 볼 대사는 unmatched·skipped 인 줄이다.
 * 대조 결과는 판정 금지의 유일한 예외이며 점수·거리는 두지 않는다.
 */
public record LineResult(UUID lineId, String outcome, int misses) {

    public static final String PASSED = "passed";
    public static final String UNMATCHED = "unmatched";
    public static final String SKIPPED = "skipped";

    /**
     * 기기가 보낸 결과를 저장된 결과 위에 얹는다 — 같은 줄은 나중 것이 이기고, 보내지 않은 줄은 그대로 남는다. 순서는
     * 처음 나타난 순서다.
     */
    public static List<LineResult> merge(List<LineResult> stored, List<LineResult> incoming) {
        Map<UUID, LineResult> byLine = new LinkedHashMap<>();
        for (LineResult result : stored) {
            byLine.put(result.lineId(), result);
        }
        for (LineResult result : incoming) {
            byLine.put(result.lineId(), result);
        }
        return new ArrayList<>(byLine.values());
    }
}
