package com.acttub.actingapi.feature.reading.domain;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** 앱 {@code apps/mobile/tests/reading-word-diff.test.mjs} 의 입력·기대값을 그대로 옮겼다. */
class WordDiffTest {

    private static List<String> marked(String target, String said) {
        return WordDiff.diff(target, said).stream().filter(WordDiff.Word::differs).map(WordDiff.Word::text).toList();
    }

    @Test
    @DisplayName("reading.session: 원문 어절 가운데 말한 것과 글자가 맞지 않는 어절만 표시한다")
    void marksOnlyWordsWithMismatchedLetters() {
        assertThat(marked("그럼 다 달라져.", "그럼 다 바뀌어")).containsExactly("달라져.");
        assertThat(WordDiff.diff("그럼 다 달라져.", "그럼 다 바뀌어")).as("원문 어절을 순서대로 모두 돌려준다").containsExactly(
                new WordDiff.Word("그럼", false), new WordDiff.Word("다", false), new WordDiff.Word("달라져.", true));
    }

    @Test
    @DisplayName("reading.session: 띄어쓰기·문장부호는 무시한다")
    void ignoresSpacingAndPunctuation() {
        assertThat(marked("여기 있을 줄 알았어.", "여기있을줄 알았어")).isEmpty();
        assertThat(marked("여기 있을 줄 알았어.", "여기 없을 줄 알았어")).containsExactly("있을");
    }

    @Test
    @DisplayName("reading.session: 빠진 말은 표시하고 더한 말은 원문에 표시하지 않는다")
    void marksMissingWordsButNotAddedOnes() {
        assertThat(marked("나는 정말 몰랐어", "나는 몰랐어")).containsExactly("정말");
        assertThat(marked("몰랐어", "진짜 나는 몰랐어")).isEmpty();
        assertThat(marked("몰랐어", "진짜 나는 알았어")).containsExactly("몰랐어");
    }

    @Test
    @DisplayName("reading.session: 괄호 안 지시는 비교하지 않는다")
    void skipsBracketedDirections() {
        assertThat(marked("(웃으며) 그런가, 정말?", "그런가 정말")).isEmpty();
        assertThat(marked("(웃으며 돌아서서) 그런가", "")).containsExactly("그런가");
    }

    @Test
    @DisplayName("reading.session: 아무 말도 없으면 원문 어절이 모두 표시된다")
    void marksEverythingWhenNothingWasSaid() {
        assertThat(marked("가자 이제", "")).containsExactly("가자", "이제");
    }

    @Test
    @DisplayName("reading.session: 1,000자를 넘으면 비교하지 않고 표시 없이 원문 어절만 준다. 공백은 JavaScript 처럼 전각 공백으로도 나눈다")
    void plainBeyondTheLimitAndSplitsOnJavaScriptWhitespace() {
        assertThat(marked("가 ".repeat(1001), "")).isEmpty();
        assertThat(marked("가 ".repeat(1000), "")).hasSize(1000);
        assertThat(WordDiff.diff("그럼　다", "그럼")).containsExactly(
                new WordDiff.Word("그럼", false), new WordDiff.Word("다", true));
    }
}
