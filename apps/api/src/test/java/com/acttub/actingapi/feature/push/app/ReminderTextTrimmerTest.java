package com.acttub.actingapi.feature.push.app;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import org.junit.jupiter.api.Test;

/** 잠금 화면에 올라가는 글을 다듬는 규칙 (account.notification). */
class ReminderTextTrimmerTest {
    private static final List<String> NONE = List.of();

    @Test
    void keepsAShortKoreanSentenceAsIs() {
        assertThat(ReminderTextTrimmer.nextTake("상대 눈을 보고 한 호흡 쉬고 대사를 시작해 보세요.", NONE, true))
                .isEqualTo("상대 눈을 보고 한 호흡 쉬고 대사를 시작해 보세요.");
    }

    @Test
    void removesTextInsideEveryKindOfQuote() {
        assertThat(ReminderTextTrimmer.nextTake("\"사랑해\"말하기 전에 숨을 한 번 들이쉬어 보세요.", NONE, true))
                .isEqualTo("말하기 전에 숨을 한 번 들이쉬어 보세요.");
        for (String quoted : List.of("\u201C사랑해\u201D", "\u2018사랑해\u2019", "'사랑해'", "\u300C사랑해\u300D", "\u300E사랑해\u300F")) {
            String result = ReminderTextTrimmer.nextTake(quoted + "말하기 전에 숨을 한 번 들이쉬어 보세요.", NONE, true);
            assertThat(result).doesNotContain("사랑해").isEqualTo("말하기 전에 숨을 한 번 들이쉬어 보세요.");
        }
    }

    @Test
    void removesScriptLinesTitlesAndCharacterNames() {
        List<String> terms = ReminderTextTrimmer.sensitiveTerms(List.of("햄릿"), List.of("오필리아"), List.of("너 없이는 못 살겠어"));
        assertThat(ReminderTextTrimmer.nextTake("너 없이는 못 살겠어를 말할 때 목소리를 낮춰 보세요.", terms, true))
                .isEqualTo("말할 때 목소리를 낮춰 보세요.");
        assertThat(ReminderTextTrimmer.nextTake("오필리아에게 말할 때 시선을 아래로 내리지 마세요.", terms, true))
                .doesNotContain("오필리아").isEqualTo("말할 때 시선을 아래로 내리지 마세요.");
        assertThat(ReminderTextTrimmer.nextTake("햄릿 장면에서 호흡을 길게 가져가 보세요.", terms, true))
                .doesNotContain("햄릿");
    }

    @Test
    void shortLinesAndOneLetterNamesAreNotRemoved() {
        // 대사 줄은 6자 이상, 제목·이름은 2자 이상만 쓴다. 짧은 말을 지우면 멀쩡한 문장이 깨진다.
        List<String> terms = ReminderTextTrimmer.sensitiveTerms(List.of("김"), List.of("나"), List.of("그래", "알았어요"));
        assertThat(terms).isEmpty();
        assertThat(ReminderTextTrimmer.nextTake("그래 알았어요 라는 마음으로 천천히 말해 보세요.", terms, true))
                .isEqualTo("그래 알았어요 라는 마음으로 천천히 말해 보세요.");
    }

    @Test
    void takesOnlyTheFirstSentence() {
        assertThat(ReminderTextTrimmer.nextTake("눈을 마주치고 천천히 말해 보세요. 그다음에 대사를 한 번 더 해 보세요.", NONE, true))
                .isEqualTo("눈을 마주치고 천천히 말해 보세요.");
    }

    @Test
    void collapsesWhitespace() {
        assertThat(ReminderTextTrimmer.nextTake("눈을   마주치고\n천천히\t말해 보세요.", NONE, true))
                .isEqualTo("눈을 마주치고 천천히 말해 보세요.");
    }

    @Test
    void fallsBackWhenHangulIsLessThanHalf() {
        assertThat(ReminderTextTrimmer.nextTake("Try to keep eye contact and breathe before the line.", NONE, true))
                .isEqualTo(ReminderTextTrimmer.FALLBACK_BODY).isEqualTo("노트에 남긴 한 가지만 해 봐도 충분해요.");
        // 한글이 절반이 안 되는 혼합문
        assertThat(ReminderTextTrimmer.nextTake("Keep eye contact 하고 breathe slowly 해요", NONE, true))
                .isEqualTo(ReminderTextTrimmer.FALLBACK_BODY);
    }

    @Test
    void fallsBackWhenTooShortAfterCleaning() {
        assertThat(ReminderTextTrimmer.nextTake("천천히 해요.", NONE, true)).isEqualTo(ReminderTextTrimmer.FALLBACK_BODY);
        assertThat(ReminderTextTrimmer.nextTake("\"사랑해 정말 사랑해\" 해요", NONE, true)).isEqualTo(ReminderTextTrimmer.FALLBACK_BODY);
        assertThat(ReminderTextTrimmer.nextTake("   ", NONE, true)).isEqualTo(ReminderTextTrimmer.FALLBACK_BODY);
        assertThat(ReminderTextTrimmer.nextTake(null, NONE, true)).isEqualTo(ReminderTextTrimmer.FALLBACK_BODY);
    }

    @Test
    void cutsLongTextAtAWordBoundaryAndAppendsAnEllipsis() {
        String raw = "상대의 대사가 끝날 때까지 기다린 뒤에 천천히 숨을 들이쉬고 나서 말을 시작해 보세요";
        String result = ReminderTextTrimmer.nextTake(raw, NONE, true);
        assertThat(result).endsWith("\u2026");
        String head = result.substring(0, result.length() - 1);
        assertThat(result.length()).isLessThanOrEqualTo(ReminderTextTrimmer.NEXT_TAKE_MAX + 1);
        assertThat(raw).startsWith(head);
        // 단어 중간에서 끊기지 않는다: 잘린 자리 바로 다음이 공백이거나 글이 끝이다
        assertThat(raw.charAt(head.length())).isEqualTo(' ');
        assertThat(head).doesNotEndWith(" ");
    }

    @Test
    void doesNotCutTextOfExactlyTheMaximumLength() {
        String forty = "가나다라마 바사아자차 카타파하가 나다라마바 사아자차카 타파하가나 다라마바사".substring(0, 40);
        assertThat(forty).hasSize(40);
        assertThat(ReminderTextTrimmer.nextTake(forty, NONE, true)).isEqualTo(forty);
    }

    @Test
    void nonKoreanLocaleSkipsTheHangulCheckButKeepsTheOtherRules() {
        assertThat(ReminderTextTrimmer.nextTake("Try to keep eye contact and breathe before the line.", NONE, false))
                .isEqualTo("Try to keep eye contact and breathe\u2026");
        assertThat(ReminderTextTrimmer.nextTake("Breathe.", NONE, false)).isEqualTo(ReminderTemplates.HOMEWORK_FALLBACK_EN);
    }

    @Test
    void questionPicksTheLastQuestionSentenceAndCutsToAboutThirtyCharacters() {
        assertThat(ReminderTextTrimmer.question("좋아요. 그 장면 잘 봤어요. 그리고 왜 그런가요?", NONE, true)).contains("그리고 왜 그런가요?");
        String raw = "이 장면에서 인물이 정말로 숨기고 싶었던 감정은 무엇이었다고 생각해요?";
        String result = ReminderTextTrimmer.question(raw, NONE, true).orElseThrow();
        assertThat(result).endsWith("\u2026");
        assertThat(result.length()).isLessThanOrEqualTo(ReminderTextTrimmer.QUESTION_MAX + 1);
        assertThat(raw).startsWith(result.substring(0, result.length() - 1));
    }

    @Test
    void questionIsEmptyWhenNotUsable() {
        assertThat(ReminderTextTrimmer.question("Why did you pause there?", NONE, true)).isEmpty();
        assertThat(ReminderTextTrimmer.question("왜요?", NONE, true)).isEmpty();
        assertThat(ReminderTextTrimmer.question("\"그 대사를 왜 그렇게 말했어요?\"", NONE, true)).isEmpty();
    }

    @Test
    void questionRemovesScriptLines() {
        List<String> terms = ReminderTextTrimmer.sensitiveTerms(List.of(), List.of(), List.of("그만 돌아가 주세요 제발"));
        assertThat(ReminderTextTrimmer.question("그만 돌아가 주세요 제발라고 할 때 어떤 마음이었어요?", terms, true))
                .contains("할 때 어떤 마음이었어요?");
    }
}
