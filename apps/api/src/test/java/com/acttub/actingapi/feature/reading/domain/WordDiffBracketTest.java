package com.acttub.actingapi.feature.reading.domain;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;

import org.junit.jupiter.api.Test;

/** reading.memorization: 괄호 안 지문은 비교하지 않고, 숫자도 글자처럼 비교하며, 너무 긴 입력은 표시 없이 돌려준다. */
class WordDiffBracketTest {
    @Test void everyBracketStyleHidesItsDirectionFromTheComparison() {
        List<WordDiff.Word> words = WordDiff.diff("（웃으며） [작게] 【사이】 (한숨) 가지 마", "가지 마");
        assertThat(words).extracting(WordDiff.Word::differs).containsExactly(false, false, false, false, false, false);
    }

    @Test void numbersAreComparedLikeLetters() {
        assertThat(WordDiff.diff("3층 ⅳ호 ²번", "삼층 ⅳ호 ²번")).containsExactly(
                new WordDiff.Word("3층", true), new WordDiff.Word("ⅳ호", false), new WordDiff.Word("²번", false));
    }

    @Test void anOverlongLineIsShownWithoutMarks() {
        String target = "가".repeat(LineMatch.INPUT_MAX + 1);
        assertThat(WordDiff.diff(target, "나")).containsExactly(new WordDiff.Word(target, false));
        assertThat(WordDiff.diff("가지 마", "나".repeat(LineMatch.INPUT_MAX + 1)))
                .containsExactly(new WordDiff.Word("가지", false), new WordDiff.Word("마", false));
    }

    @Test void nameMatchingIgnoresTooShortRosterNamesAndForeignPunctuation() {
        assertThat(CharacterNames.fix("김민수수", List.of("김", "김민수"))).isEqualTo("김민수");
        assertThat(CharacterNames.fix("Mr. 박-", List.of("Mr. 박"))).isEqualTo("Mr. 박");
        assertThat(CharacterNames.fix("Mr. 박-1", List.of("Mr. 박"))).as("숫자가 붙은 이름은 다른 사람이다(SOMA-709)").isEqualTo("Mr. 박-1");
        assertThat(CharacterNames.fix("ミンス", List.of("민수"))).as("가나만 쓴 이름은 글자를 빼고 거리 2 안의 이름으로(ロス 사례)").isEqualTo("민수");
    }

    @Test void namesAndLineSimilarityHandleEmptyInput() {
        assertThat(ScriptRules.normalizedName(null)).isNull();
        assertThat(ScriptRules.normalizedName("  ")).isNull();
        assertThat(ScriptRules.namesAllowed(java.util.Arrays.asList("지수", null))).isFalse();
        assertThat(ScriptRules.namesAllowed(List.of("지수", " 민호"))).isFalse();
        assertThat(ScriptRules.namesAllowed(List.of("지수", "지수"))).isFalse();
        assertThat(ScriptRules.namesAllowed(List.of("지수", "민호"))).isTrue();
        assertThat(LineMatch.similarity("(웃음)", "...")).isEqualTo(1.0);
        assertThat(LineMatch.similarity("abc", "abd")).isCloseTo(2.0 / 3.0, org.assertj.core.data.Offset.offset(1e-9));
    }
}
