package com.acttub.actingapi.feature.reading.domain;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * 원문과 다르게 말한 대사 하나 (reading.session) — 구간 안에서 결과가 {@code unmatched} 인 줄이다. 완료 화면·전체 보기·
 * 회차 상세가 이것으로 원문의 다른 어절을 칠하고 아래에 말한 것을 보인다. 말한 것이 없는 줄(기기가 결과만 보냄)은
 * {@code said} 가 {@code null} 이고 어절에 표시가 없다.
 *
 * @param dialogueNo 대본 안 대사 번호(1부터)
 * @param words 원문 어절 전부, 순서대로
 */
public record DifferentLine(UUID lineId, int dialogueNo, String said, List<WordDiff.Word> words) {

    /** 구간 안 대사 줄 하나. */
    public record Dialogue(UUID lineId, int dialogueNo, String text) {
    }

    /** @param range 구간 안 대사 줄, 줄 순서 */
    public static List<DifferentLine> of(List<Dialogue> range, List<LineResult> results) {
        Map<UUID, LineResult> byLine = results.stream().collect(Collectors.toMap(LineResult::lineId, Function.identity()));
        List<DifferentLine> out = new ArrayList<>();
        for (Dialogue line : range) {
            LineResult result = byLine.get(line.lineId());
            if (result == null || !LineResult.UNMATCHED.equals(result.outcome())) {
                continue;
            }
            List<WordDiff.Word> words = result.said() == null
                    ? WordDiff.plain(line.text())
                    : WordDiff.diff(line.text(), result.said());
            out.add(new DifferentLine(line.lineId(), line.dialogueNo(), result.said(), words));
        }
        return out;
    }
}
