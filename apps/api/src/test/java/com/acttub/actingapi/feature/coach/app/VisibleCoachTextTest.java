package com.acttub.actingapi.feature.coach.app;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;

class VisibleCoachTextTest {
    private static List<String> feed(boolean opening, String raw, int size) {
        var out = new ArrayList<String>();
        var visible = new VisibleCoachText(opening, out::add);
        for (int i = 0; i < raw.length(); i += size) visible.accept(raw.substring(i, Math.min(raw.length(), i + size)));
        return out;
    }

    @Test void openingShowsOnlyTheCoachPartEvenWhenTagsArriveSplit() {
        String raw = DirectVideoCoachTest.OPENING;
        for (int size : new int[] {1, 2, 3, 7, 50}) {
            var out = feed(true, raw, size);
            assertThat(String.join("", out).strip()).as("조각 크기 %d", size).isEqualTo(DirectVideoCoachTest.OPENING_SHOWN);
            assertThat(out).noneMatch(piece -> piece.contains("<") || piece.contains("인물:"));
        }
        assertThat(feed(true, raw, 1).size()).as("한 글자씩 흘러간다").isGreaterThan(10);
    }

    @Test void notActingOpeningShowsNothing() {
        String raw = "<설계>\n영상: 연기 아님 — 뉴스 화면\n</설계>\n<코치>\n없음\n</코치>";
        assertThat(feed(true, raw, 2)).isEmpty();
    }

    @Test void laterTurnsHideTheThinkingMemoAndHiddenLines() {
        String raw = "<생각>\n배우가 한 말: 붙잡고 싶었다\n이번 목표: 어긋남\n</생각>\n<다음 테이크>상대 눈을 보며 말해 본다</다음 테이크>\n"
                + "붙잡히고 싶은 마음이 먼저였군요.\n그 마음은 어느 대사에서 커요?";
        for (int size : new int[] {1, 4, 9, 200}) {
            String shown = String.join("", feed(false, raw, size));
            assertThat(shown).as("조각 크기 %d", size).isEqualTo("붙잡히고 싶은 마음이 먼저였군요.\n그 마음은 어느 대사에서 커요?");
        }
    }

    @Test void memoLinesWithoutTagsAreHeldBack() {
        String raw = "배우가 한 말: 모르겠다\n끝 질문: 무엇이 막혔나\n그때 무엇이 가장 막혔어요?";
        assertThat(String.join("", feed(false, raw, 1))).isEqualTo("그때 무엇이 가장 막혔어요?");
    }

    @Test void ordinaryWordsThatStartLikeAMemoLabelAreReleased() {
        String raw = "내가 보기엔 말끝이 내려가요. 이번에는 어땠어요?";
        assertThat(String.join("", feed(false, raw, 1))).isEqualTo(raw);
    }

    @Test void theModelsWordsAreNotTrimmedOrShortened() {
        // 스트리밍은 다듬지 않는다(2026-10-16): 시간 표기·두 번째 질문도 모델이 쓴 그대로다.
        String raw = "0:23에 시선이 내려가요. 그때 어땠어요? 다른 대사에서도요?";
        assertThat(String.join("", feed(false, raw, 3))).isEqualTo(raw);
    }

    // 영상 없는 내려놓기 답(2026-10-21 재측정 18회 중 4회)에서 나온 메모 태그 모양 넷. 배우 화면에는 태그가 한 글자도 나가면 안 된다.
    private static final String ANSWER = "아, 그럼 이 이야기로 아빠한테 뭘 느끼게 하려 했어요?";

    private static String streamed(String raw, int size) {
        var out = new ArrayList<String>();
        var visible = new VisibleCoachText(false, out::add);
        try {
            for (int i = 0; i < raw.length(); i += size) visible.accept(raw.substring(i, Math.min(raw.length(), i + size)));
        } catch (VisibleCoachText.Broken broken) {
            broken.text();
            return "[끊김]" + String.join("", out);
        }
        return String.join("", out);
    }

    @Test void anOpenedButNeverClosedThoughtTagShowsNothingSoTheReplyIsRewritten() {
        for (int size : new int[] {1, 5, 200}) assertThat(streamed("<thought>\n" + ANSWER, size)).as("조각 %d", size).isEmpty();
    }

    @Test void aMisspelledEnglishMemoTagIsCutBeforeAnythingIsShown() {
        for (int size : new int[] {1, 5, 200}) {
            String shown = streamed("<th-thought>" + ANSWER, size);
            assertThat(shown).as("조각 %d", size).isEqualTo("[끊김]");
            assertThat(DirectVideoPracticeLoop.looksBroken(DirectVideoPracticeLoop.parse("<th-thought>" + ANSWER).message(), null)).isTrue();
        }
    }

    @Test void aKoreanNamedLeadingTagIsCutBeforeAnythingIsShown() {
        for (int size : new int[] {1, 5, 200}) {
            assertThat(streamed("<추가>\n" + ANSWER, size)).as("조각 %d", size).isEqualTo("[끊김]");
        }
        assertThat(DirectVideoPracticeLoop.looksBroken(DirectVideoPracticeLoop.parse("<추가>\n" + ANSWER).message(), null)).isTrue();
    }

    @Test void aKoreanTagInTheMiddleOfAnAnswerIsNotTreatedAsBroken() {
        String quoted = "지문 <웃음> 뒤에 목소리가 낮아졌어요. 그때 무엇을 하려 했어요?";
        assertThat(streamed(quoted, 3)).isEqualTo(quoted);
        assertThat(DirectVideoPracticeLoop.looksBroken(quoted, null)).isFalse();
    }

    @Test void aMemoOpenedWithKoreanAndClosedWithEnglishHidesTheMemoAndShowsTheAnswer() {
        String raw = "<생각>\n배우가 한 말: 밝은 모습\n이번 목표: 하려던 것\n</thought>" + ANSWER;
        for (int size : new int[] {1, 5, 200}) assertThat(streamed(raw, size)).as("조각 %d", size).isEqualTo(ANSWER);
        assertThat(DirectVideoPracticeLoop.parse(raw).message()).isEqualTo(ANSWER);
    }

    @Test void unclosedThinkingTagLineIsNotStreamed() {
        assertThat(VisibleCoachText.visible("<thought\n화를 누르니까 더 집중됐군요.", false)).isEqualTo("화를 누르니까 더 집중됐군요.");
        // 줄이 아직 안 끝났으면 다음 조각까지 잡아 둔다.
        assertThat(VisibleCoachText.visible("<thought", false)).isEmpty();
    }
}
