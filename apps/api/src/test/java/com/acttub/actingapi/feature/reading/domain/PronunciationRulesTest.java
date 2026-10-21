package com.acttub.actingapi.feature.reading.domain;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;

import com.acttub.actingapi.feature.reading.domain.PronunciationRules.Habit;
import com.acttub.actingapi.feature.reading.domain.PronunciationRules.HabitItem;
import com.acttub.actingapi.feature.reading.domain.PronunciationRules.LineInput;
import com.acttub.actingapi.feature.reading.domain.PronunciationRules.Phone;
import com.acttub.actingapi.feature.reading.domain.PronunciationRules.Report;
import com.acttub.actingapi.feature.reading.domain.PronunciationRules.ScoredLine;
import com.acttub.actingapi.feature.reading.domain.PronunciationRules.Word;
import org.junit.jupiter.api.Test;

class PronunciationRulesTest {

    private static Phone ok(String jamo, boolean vowel, int syl) {
        return new Phone(jamo, jamo, 1.0, vowel, syl, 0, 100, false);
    }

    private static Phone bad(String expected, String heard, double lpr, boolean vowel, int syl) {
        return new Phone(expected, heard, lpr, vowel, syl, 200, 300, true);
    }

    private static Word word(int i, String w, Phone... phones) {
        return new Word(i, w, false, List.of(phones));
    }

    @Test
    void 받아쓴_글이_없거나_대본과_다르게_읽은_줄은_뺀다() {
        ScoredLine scored = new ScoredLine("다리가 아파", List.of(word(0, "다리가", bad("ㄹ", "ㄴ", -5, false, 1))));
        Report report = PronunciationRules.build(List.of(
                new LineInput(1, "다리가 아파", null, scored),
                new LineInput(2, "다리가 아파", "  ", scored),
                new LineInput(3, "다리가 아파", "오늘 날씨 좋네요 정말로", scored)));
        assertThat(report.empty()).isTrue();
        assertThat(report.skippedLines()).containsExactly(1, 2, 3);
    }

    @Test
    void 한_어절에서는_가장_낮은_소리_하나만_세고_습관은_두_번_이상일_때만_낸다() {
        ScoredLine line = new ScoredLine("다리 머리", List.of(
                word(0, "다리", ok("ㄷ", false, 0), ok("ㅏ", true, 0), bad("ㄹ", "ㄴ", -4, false, 1), bad("ㅣ", "ㅔ", -6, true, 1)),
                word(1, "머리", ok("ㅁ", false, 0), ok("ㅓ", true, 0), bad("ㄹ", "ㄴ", -5, false, 1), ok("ㅣ", true, 1))));
        Report report = PronunciationRules.build(List.of(new LineInput(1, "다리 머리", "다리 머리", line)));
        assertThat(report.summary().sounds()).isEqualTo(8);
        assertThat(report.summary().clearSounds()).isEqualTo(5);
        assertThat(report.habit()).isNull(); // 모음 1(다리의 ㅣ, 더 낮다) + 첫소리 1 — 둘 다 한 번
        Report twice = PronunciationRules.build(List.of(
                new LineInput(1, "다리 머리", "다리 머리", line), new LineInput(2, "다리 머리", "다리 머리", line)));
        assertThat(twice.habit().habit()).isIn(Habit.VOWEL, Habit.ONSET);
        assertThat(twice.habit().count()).isEqualTo(2);
    }

    @Test
    void 감탄사_숫자_어절_고요의_구요는_짚지_않는다() {
        Word number = new Word(1, "육십개", true, List.of(bad("ㄱ", "ㄴ", -7, false, 2)));
        ScoredLine line = new ScoredLine("아 육십개 있고요", List.of(
                word(0, "아", bad("ㅏ", "ㅔ", -5, true, 0)), number,
                word(2, "있고요", ok("ㅣ", true, 0), bad("ㅗ", "ㅜ", -4, true, 1))));
        Report report = PronunciationRules.build(List.of(new LineInput(1, "아 60개 있고요", "아 육십 개 있구요", line)));
        assertThat(report.summary().sounds()).isEqualTo(2);
        assertThat(report.summary().clearSounds()).isEqualTo(2);
        assertThat(report.habit()).isNull();
    }

    @Test
    void 대본대로_읽은_줄에서_다른_말로_받아쓴_어절을_고른다() {
        ScoredLine line = new ScoredLine("육백억이요 전액 캐쉬", List.of(
                word(0, "육백억이요", ok("ㅠ", true, 0)), word(1, "전액", ok("ㅈ", false, 0)), word(2, "캐쉬", ok("ㅋ", false, 0))));
        Report report = PronunciationRules.build(List.of(new LineInput(11, "육백억이요. 전액 캐쉬.", "육백억이요 전에 캐쉬", line)));
        assertThat(report.misheard()).singleElement().satisfies(m -> {
            assertThat(m.word()).isEqualTo("전액");
            assertThat(m.heard()).isEqualTo("전에");
            assertThat(m.lineNo()).isEqualTo(11);
        });
    }

    @Test
    void 자모_유사도() {
        assertThat(PronunciationRules.similarity("전액", "전액")).isEqualTo(1.0);
        assertThat(PronunciationRules.similarity("전액", "전에")).isBetween(0.5, 0.8);
        assertThat(PronunciationRules.similarity("", "")).isEqualTo(1.0);
    }

    @Test
    void 받아쓰기의_숫자는_한글로_읽어_대본과_맞춘다() {
        ScoredLine line = new ScoredLine("나 벌써 스물아홉이야", List.of(
                word(0, "나", ok("ㄴ", false, 0)), word(1, "벌써", ok("ㅂ", false, 0)), word(2, "스물아홉이야", ok("ㅅ", false, 0))));
        Report report = PronunciationRules.build(List.of(new LineInput(6, "나 벌써 스물아홉이야.", "나 벌써 29이야", line)));
        assertThat(report.skippedLines()).isEmpty();
        assertThat(report.summary().linesUsed()).isEqualTo(1);
        assertThat(report.misheard()).as("숫자로 받아쓴 것은 다르게 알아들은 말이 아니다").isEmpty();
    }

    @Test
    void 받아쓰기가_잘렸어도_들은_소리가_대본과_같으면_쓰되_다르게_알아들은_말은_내지_않는다() {
        List<Word> words = List.of(word(0, "오디션", bad("ㅗ", "ㅓ", -5, true, 0)), word(1, "떨어진", ok("ㄸ", false, 0)),
                word(2, "거", ok("ㄱ", false, 0)));
        Report heard = PronunciationRules.build(List.of(new LineInput(4, "오디션 떨어진 거", "김", new ScoredLine("오디션 떨어진 거", words, 0.86))));
        assertThat(heard.skippedLines()).isEmpty();
        assertThat(heard.summary().linesUsed()).isEqualTo(1);
        assertThat(heard.misheard()).isEmpty();

        Report half = PronunciationRules.build(List.of(new LineInput(4, "오디션 떨어진 거", "김", new ScoredLine("오디션 떨어진 거", words, 0.42))));
        assertThat(half.skippedLines()).containsExactly(4);
        Report old = PronunciationRules.build(List.of(new LineInput(4, "오디션 떨어진 거", "김", new ScoredLine("오디션 떨어진 거", words))));
        assertThat(old.skippedLines()).containsExactly(4);
    }

    @Test
    void 숫자_읽기() {
        assertThat(KoreanNumbers.readings("나 29이야")).containsExactly("나 29이야", "나 이십구이야", "나 스물아홉이야");
        assertThat(KoreanNumbers.sino(6_000_000)).isEqualTo("육백만");
        assertThat(KoreanNumbers.sino(10_000)).isEqualTo("만");
        assertThat(KoreanNumbers.sino(1_150)).isEqualTo("천백오십");
        assertThat(KoreanNumbers.readings("숫자 없음")).containsExactly("숫자 없음");
    }

    @Test
    void 습관은_같은_소리가_같은_소리로_확실히_바뀐_것이_두_번_이상일_때만_낸다() {
        ScoredLine mixed = new ScoredLine("너 머리", List.of(
                word(0, "너", ok("ㄴ", false, 0), bad("ㅓ", "ㅗ", -7, true, 0)),
                word(1, "머리", ok("ㅁ", false, 0), bad("ㅓ", "ㅏ", -7, true, 0), ok("ㄹ", false, 1), ok("ㅣ", true, 1))));
        assertThat(PronunciationRules.build(List.of(new LineInput(1, "너 머리", "너 머리", mixed))).habit())
                .as("모음이 두 번 짚혔어도 바뀐 소리가 다르면 습관이 아니다").isNull();

        ScoredLine weak = new ScoredLine("너 거기", List.of(
                word(0, "너", ok("ㄴ", false, 0), bad("ㅓ", "ㅗ", -4, true, 0)),
                word(1, "거기", ok("ㄱ", false, 0), bad("ㅓ", "ㅗ", -4.5, true, 0))));
        assertThat(PronunciationRules.build(List.of(new LineInput(1, "너 거기", "너 거기", weak))).habit())
                .as("lpr -5 보다 덜 확실하면 세지 않는다").isNull();

        ScoredLine sure = new ScoredLine("너 거기", List.of(
                word(0, "너", ok("ㄴ", false, 0), bad("ㅓ", "ㅗ", -6, true, 0)),
                word(1, "거기", ok("ㄱ", false, 0), bad("ㅓ", "ㅗ", -5.5, true, 0))));
        HabitItem habit = PronunciationRules.build(List.of(new LineInput(1, "너 거기", "너 거기", sure))).habit();
        assertThat(habit.habit()).isEqualTo(Habit.VOWEL);
        assertThat(habit.count()).isEqualTo(2);
        assertThat(habit.examples()).extracting(e -> e.expected() + e.heard()).containsOnly("ㅓㅗ");
    }
}
