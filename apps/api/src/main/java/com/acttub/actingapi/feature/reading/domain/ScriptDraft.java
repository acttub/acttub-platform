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
 * @param characterMembers {@code characterNames} 와 같은 자리의, 함께 말하는 줄의 묶음 배역이면 그 줄을 함께 말하는 배역들의 자리(SOMA-709,
 *        {@link SpeakerGroups}). 보통 배역은 비어 있다. {@code null} 이면 모두 보통 배역
 * @param unnamedCast 원문에 배역 이름이 없어 서버가 배역 이름(「화자」)을 지은 독백인가(SOMA-597, {@link Monologue}). 배우가 이름을 정할 때까지
 *        배역에 표시해 둔다
 */
public record ScriptDraft(
        String title,
        String rawText,
        String source,
        List<String> characterNames,
        List<Line> lines,
        List<CharacterTraits> characterTraits,
        List<List<Integer>> characterMembers,
        boolean unnamedCast) {

    public ScriptDraft {
        characterNames = List.copyOf(characterNames);
        lines = List.copyOf(lines);
        characterTraits = characterTraits == null
                ? Collections.nCopies(characterNames.size(), CharacterTraits.UNKNOWN)
                : List.copyOf(characterTraits);
        if (characterTraits.size() != characterNames.size()) {
            throw new IllegalArgumentException("characterTraits must line up with characterNames");
        }
        characterMembers = characterMembers == null
                ? Collections.nCopies(characterNames.size(), List.of())
                : characterMembers.stream().map(List::copyOf).toList();
        if (characterMembers.size() != characterNames.size()) {
            throw new IllegalArgumentException("characterMembers must line up with characterNames");
        }
    }

    /** 배역 이름을 원문에서 읽은 대본. */
    public ScriptDraft(String title, String rawText, String source, List<String> characterNames, List<Line> lines,
            List<CharacterTraits> characterTraits, List<List<Integer>> characterMembers) {
        this(title, rawText, source, characterNames, lines, characterTraits, characterMembers, false);
    }

    /** 묶음 배역이 없는 대본 — 나누기 조립 중간과 묶기 전. */
    public ScriptDraft(String title, String rawText, String source, List<String> characterNames, List<Line> lines,
            List<CharacterTraits> characterTraits) {
        this(title, rawText, source, characterNames, lines, characterTraits, null);
    }

    /** 성별·나이대를 모르는 대본 — 기기가 나눈 대본과 예시 대본. */
    public ScriptDraft(String title, String rawText, String source, List<String> characterNames, List<Line> lines) {
        this(title, rawText, source, characterNames, lines, null, null);
    }

    /** 배역 성별·나이대만 바꾼 같은 대본(SOMA-937, {@link LateCastTraits}). */
    public ScriptDraft withTraits(List<CharacterTraits> traits) {
        return new ScriptDraft(title, rawText, source, characterNames, lines, traits, characterMembers, unnamedCast);
    }

    /** 줄마다 말과 소리 낼 글을 채운 같은 대본(SOMA-751). {@code languages} 는 줄의 ordinal → 답이고, 없는 줄은 그대로다. */
    public ScriptDraft withLanguages(java.util.Map<Integer, LineLanguage.Result> languages) {
        if (languages.isEmpty()) {
            return this;
        }
        List<Line> next = lines.stream()
                .map(line -> {
                    LineLanguage.Result result = languages.get(line.ordinal());
                    return result == null ? line : new Line(line.ordinal(), line.kind(), line.characterIndex(), line.text(),
                            result.lang(), result.speech());
                })
                .toList();
        return new ScriptDraft(title, rawText, source, characterNames, next, characterTraits, characterMembers, unnamedCast);
    }

    /**
     * @param kind {@code dialogue}·{@code direction}·{@code scene}
     * @param characterIndex 대사면 배역의 자리, 지문·장면이면 {@code null}
     * @param lang 대사의 말(ISO 639-1, {@link LineLanguage#SUPPORTED}). 모르면 {@code null} — SOMA-751
     * @param speech 상대역 목소리가 읽을 글. 줄 글과 같으면 {@code null}
     */
    public record Line(int ordinal, String kind, Integer characterIndex, String text, String lang, String speech) {
        public Line(int ordinal, String kind, Integer characterIndex, String text) {
            this(ordinal, kind, characterIndex, text, null, null);
        }
    }
}
