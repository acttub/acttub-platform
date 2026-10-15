package com.acttub.actingapi.feature.reading.domain;

import java.util.Collections;
import java.util.List;

/**
 * 저장 요청이 실어 온 대본 — 기기가 나눈 배역과 줄, 그리고 원문 (reading.script).
 *
 * <p>옛 저장 API 로는 기기 파서가 나눈 결과가, 나누기 작업으로는 서버가 모델 답을 조립한 결과({@link SplitDraft})가 이 모양으로
 * 온다. 여기 담긴 값은 이미 정리된 것이다: 제목과 배역 이름은 앞뒤 공백을 뗐다({@link ScriptRules#normalizedName}). 줄의
 * {@code characterIndex} 는 {@code characterNames} 의 자리(0부터)이고 대사 줄에만 있다.
 *
 * @param source 입력 경로 — {@code file}·{@code paste}·{@code typed}·{@code sample}. 서버는 예시를 구분하지
 *        않는다
 * @param characterTraits {@code characterNames} 와 같은 자리의 성별·나이대(SOMA-670). 나누기 작업만 채우고 나머지는 모두
 *        모름이다. {@code null} 이면 모두 모름
 */
public record ScriptDraft(
        String title,
        String rawText,
        String source,
        List<String> characterNames,
        List<Line> lines,
        List<CharacterTraits> characterTraits) {

    public ScriptDraft {
        characterNames = List.copyOf(characterNames);
        lines = List.copyOf(lines);
        characterTraits = characterTraits == null
                ? Collections.nCopies(characterNames.size(), CharacterTraits.UNKNOWN)
                : List.copyOf(characterTraits);
        if (characterTraits.size() != characterNames.size()) {
            throw new IllegalArgumentException("characterTraits must line up with characterNames");
        }
    }

    /** 성별·나이대를 모르는 대본 — 기기가 나눈 대본과 예시 대본. */
    public ScriptDraft(String title, String rawText, String source, List<String> characterNames, List<Line> lines) {
        this(title, rawText, source, characterNames, lines, null);
    }

    /**
     * @param kind {@code dialogue}·{@code direction}·{@code scene}
     * @param characterIndex 대사면 배역의 자리, 지문·장면이면 {@code null}
     */
    public record Line(int ordinal, String kind, Integer characterIndex, String text) {
    }
}
