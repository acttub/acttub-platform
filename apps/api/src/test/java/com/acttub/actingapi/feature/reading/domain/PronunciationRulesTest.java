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
import com.acttub.actingapi.feature.reading.domain.PronunciationRules.Misheard;
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
    void 줄마다_lpr_마이너스3_이하로_짚힌_어절을_낮은_순으로_두_개까지_칠한다() {
        ScoredLine line = new ScoredLine("다리 머리 허리 소리", List.of(
                word(0, "다리", ok("ㄷ", false, 0), bad("ㅏ", "ㅓ", -3.5, true, 0)),
                word(1, "머리", ok("ㅁ", false, 0), bad("ㅓ", "ㅗ", -8, true, 0)),
                word(2, "허리", ok("ㅎ", false, 0), bad("ㅓ", "ㅗ", -2.5, true, 0)),
                word(3, "소리", ok("ㅅ", false, 0), bad("ㅗ", "ㅜ", -4, true, 0))));
        Report report = PronunciationRules.build(List.of(
                new LineInput(7, "다리 머리 허리 소리", "다리 머리 허리 소리", line),
                new LineInput(8, "다리가 아파", null, line)));
        assertThat(report.lines()).hasSize(1);
        assertThat(report.lines().get(0).lineNo()).isEqualTo(7);
        assertThat(report.lines().get(0).text()).isEqualTo("다리 머리 허리 소리");
        // -2.5(허리)는 문턱 밖, -3.5(다리)는 셋째로 낮아 빠진다. 남은 둘은 줄 안 순서로.
        assertThat(report.lines().get(0).marks()).extracting(PronunciationRules.Mark::word).containsExactly("머리", "소리");
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
        // 받아쓰기('김')로 고른 말은 없고, 칠한 어절의 들린 소리만 남는다.
        assertThat(heard.misheard()).singleElement().satisfies(m -> {
            assertThat(m.word()).isEqualTo("오디션");
            assertThat(m.heard()).startsWith("'어'처럼 들렸어요");
        });

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

    @Test
    void 칠한_어절마다_그_소리를_들린_소리로_바꿔_읽은_말을_붙인다() {
        // 안녕 = [ㅏ ㄴ][ㄴ ㅕ ㅇ] — 둘째 음절 첫소리 ㄴ이 ㅁ으로 들렸다(11/1 운영 녹음과 같은 결과).
        Word annyeong = word(0, "안녕", ok("ㅏ", true, 0), ok("ㄴ", false, 0),
                bad("ㄴ", "ㅁ", -5.1, false, 1), ok("ㅕ", true, 1), ok("ㅇ", false, 1));
        // 앉아는 소리대로 [ㅏ ㄴ][ㅈ ㅏ] — ㅈ이 ㅊ으로 들렸다.
        Word anja = word(1, "앉아", ok("ㅏ", true, 0), ok("ㄴ", false, 0), bad("ㅈ", "ㅊ", -4, false, 1), ok("ㅏ", true, 1));
        // 받침이 다르게 들린 것: 밥 [ㅂ ㅏ ㅂ] 의 받침 ㅂ → ㄱ
        Word bap = word(2, "밥", ok("ㅂ", false, 0), ok("ㅏ", true, 0), bad("ㅂ", "ㄱ", -6, false, 0));
        Report report = PronunciationRules.build(List.of(
                new LineInput(8, "안녕.", "안녕", new ScoredLine("안녕", List.of(annyeong))),
                new LineInput(3, "앉아 밥", "앉아 밥", new ScoredLine("앉아 밥", List.of(anja, bap)))));
        assertThat(report.misheard()).extracting(m -> m.lineNo() + ":" + m.word() + "→" + m.heard().split("처럼")[0])
                .containsExactly("3:앉아→'안차'", "3:밥→'박'", "8:안녕→'안명'");
        assertThat(report.misheard().get(2).heard()).isEqualTo("'안명'처럼 들렸어요. '녕'의 첫소리 ㄴ이 ㅁ에 가까웠어요(자음이 바뀜). "
                + "둘 다 콧소리예요. ㄴ은 혀끝을 윗잇몸에 대고, ㅁ은 두 입술을 닫아요. 입술은 뗀 채 혀끝을 윗잇몸에 대고 '녀-녀-녕', 그다음 '안녕'.");
        assertThat(report.lines()).filteredOn(l -> l.lineNo() == 8).singleElement()
                .satisfies(l -> assertThat(l.marks().get(0).detail().where()).isEqualTo("'녕'의 첫소리 ㄴ이 ㅁ에 가까웠어요"));
        for (Misheard m : report.misheard()) {
            System.out.println("PREVIEW " + m.word() + " → " + m.heard());
        }
    }

    @Test
    void 음절_자리가_없거나_그_자리에_올_수_없는_소리면_들린_말을_만들지_않는다() {
        Word noSyllable = new Word(0, "다리", false, List.of(new Phone("ㄹ", "ㄴ", -5, false, null, 0, 100, true)));
        assertThat(PronunciationRules.heardWord(noSyllable, noSyllable.phones().get(0))).isNull();
        Phone toTense = bad("ㅂ", "ㄸ", -5, false, 0);
        Word coda = word(0, "밥", ok("ㅂ", false, 0), ok("ㅏ", true, 0), toTense);
        assertThat(PronunciationRules.heardWord(coda, toTense)).as("ㄸ은 받침에 올 수 없다").isNull();
    }

    @Test
    void 받아쓰기로_고른_말은_같은_어절의_들린_소리가_있으면_빼고_세_개까지만_더한다() {
        // 전액은 소리대로 [ㅈ ㅓ][ㄴ ㅐ ㄱ] — 받침 ㄱ이 ㄷ으로 들렸다.
        Word jeonaek = word(1, "전액", ok("ㅈ", false, 0), ok("ㅓ", true, 0), ok("ㄴ", false, 1),
                ok("ㅐ", true, 1), bad("ㄱ", "ㄷ", -4, false, 1));
        ScoredLine line = new ScoredLine("육백억이요 전액 캐쉬", List.of(word(0, "육백억이요", ok("ㅠ", true, 0)), jeonaek,
                word(2, "캐쉬", ok("ㅋ", false, 0))));
        Report report = PronunciationRules.build(List.of(new LineInput(11, "육백억이요. 전액 캐쉬.", "육백억이요 전에 캐쉬", line)));
        assertThat(report.misheard()).singleElement().satisfies(m -> {
            assertThat(m.word()).isEqualTo("전액");
            assertThat(m.heard()).startsWith("'저낻'처럼 들렸어요");
        });
    }
}
