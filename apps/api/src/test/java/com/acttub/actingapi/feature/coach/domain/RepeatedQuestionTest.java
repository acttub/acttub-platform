package com.acttub.actingapi.feature.coach.domain;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Optional;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * 코치가 같은 세션에서 이미 물은 질문을 다시 내면 잡는다. 유료 호출 없이 서버 문자열
 * 연산만으로 판정하므로 임계값은 고정 픽스처로 못박는다 — 바꾸면 여기가 먼저 빨개진다.
 */
class RepeatedQuestionTest {

    private static final String EARLIER =
            "이 말을 상대에게 건넬 때, 상대가 어떻게 되길 바라는 거야?";

    @Test
    @DisplayName("문장부호·공백·전각만 다른 같은 질문은 정확 반복이다")
    void exactRepeatIgnoresPunctuationWhitespaceAndWidth() {
        Optional<RepeatedQuestion.Match> match = RepeatedQuestion.find(
                "이 말을  상대에게 건넬 때 상대가 어떻게 되길 바라는 거야 ？",
                turns(EARLIER));

        assertThat(match).isPresent();
        assertThat(match.get().rule()).isEqualTo("exact");
        assertThat(match.get().earlier()).isEqualTo(EARLIER);
    }

    @Test
    @DisplayName("어미만 바꾼 되풀이는 글자 3-gram 겹침으로 잡는다")
    void paraphraseWithHighTrigramOverlapIsARepeat() {
        Optional<RepeatedQuestion.Match> match = RepeatedQuestion.find(
                "이 말을 상대에게 건넬 때, 상대가 어떻게 되길 바라는 걸까?",
                turns(EARLIER));

        assertThat(match).isPresent();
        assertThat(match.get().rule()).isEqualTo("trigram");
        assertThat(match.get().similarity()).isGreaterThanOrEqualTo(0.6);
    }

    @Test
    @DisplayName("앞말만 다르고 끝의 질문이 같으면 질문 핵 반복이다")
    void sameQuestionCoreAfterDifferentPreambleIsARepeat() {
        Optional<RepeatedQuestion.Match> match = RepeatedQuestion.find(
                "그렇구나, 그 지점이 중요해 보여. 지금 네가 고른 그 대사에서 그 상황을 생각하면, "
                        + "상대가 어떻게 되길 바라는 거야?",
                turns("좋아, 방금 말한 게 핵심이야. 상대가 어떻게 되길 바라는 거야?"));

        assertThat(match).isPresent();
        assertThat(match.get().rule()).isEqualTo("question_core");
    }

    @Test
    @DisplayName("다른 질문은 잡지 않는다")
    void differentQuestionIsNotARepeat() {
        assertThat(RepeatedQuestion.find(
                "네가 처음 막힌 대사는 어느 줄이야?",
                turns(EARLIER, "그 순간 상대는 어디에 있었어?")))
                .isEmpty();
    }

    @Test
    @DisplayName("배우 턴은 비교 대상이 아니다 — 배우 말을 인용하는 것은 반복이 아니다")
    void actorTurnsAreIgnored() {
        List<CoachTurnSnapshot> turns = List.of(
                new CoachTurnSnapshot("actor", EARLIER),
                new CoachTurnSnapshot("ai", "그 순간 상대는 어디에 있었어?"));

        assertThat(RepeatedQuestion.find(EARLIER, turns)).isEmpty();
    }

    @Test
    @DisplayName("빈 후보나 빈 이력은 반복이 아니다")
    void blankCandidateOrNoHistoryIsNotARepeat() {
        assertThat(RepeatedQuestion.find("   ", turns(EARLIER))).isEmpty();
        assertThat(RepeatedQuestion.find(EARLIER, List.of())).isEmpty();
        assertThat(RepeatedQuestion.find(null, turns(EARLIER))).isEmpty();
    }

    @Test
    @DisplayName("가장 비슷한 이전 질문 하나를 돌려준다")
    void returnsTheMostSimilarEarlierQuestion() {
        Optional<RepeatedQuestion.Match> match = RepeatedQuestion.find(
                EARLIER,
                turns("그 순간 상대는 어디에 있었어?", "이 말을 상대에게 건넬 때, 상대가 어떻게 되길 바라는 걸까?"));

        assertThat(match).isPresent();
        assertThat(match.get().earlier())
                .isEqualTo("이 말을 상대에게 건넬 때, 상대가 어떻게 되길 바라는 걸까?");
    }

    private static List<CoachTurnSnapshot> turns(String... aiTexts) {
        return java.util.Arrays.stream(aiTexts)
                .map(text -> new CoachTurnSnapshot("ai", text))
                .toList();
    }
}
