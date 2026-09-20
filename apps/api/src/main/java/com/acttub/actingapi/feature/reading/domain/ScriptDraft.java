package com.acttub.actingapi.feature.reading.domain;

import java.util.List;

/**
 * 저장 요청이 실어 온 대본 — 기기가 나눈 배역과 줄, 그리고 원문 (reading.script).
 *
 * <p>서버는 대본을 나누지 않는다. 배역 나누기는 기기의 파서가 하고 배우가 확인한 결과가 그대로 온다. 여기 담긴
 * 값은 이미 정리된 것이다: 제목과 배역 이름은 앞뒤 공백을 뗐다({@link ScriptRules#normalizedName}). 줄의
 * {@code characterIndex} 는 {@code characterNames} 의 자리(0부터)이고 대사 줄에만 있다.
 *
 * @param source 입력 경로 — {@code file}·{@code paste}·{@code typed}·{@code sample}. 서버는 예시를 구분하지
 *        않는다
 */
public record ScriptDraft(
        String title,
        String rawText,
        String source,
        List<String> characterNames,
        List<Line> lines) {

    public ScriptDraft {
        characterNames = List.copyOf(characterNames);
        lines = List.copyOf(lines);
    }

    /**
     * @param kind {@code dialogue}·{@code direction}·{@code scene}
     * @param characterIndex 대사면 배역의 자리, 지문·장면이면 {@code null}
     */
    public record Line(int ordinal, String kind, Integer characterIndex, String text) {
    }
}
