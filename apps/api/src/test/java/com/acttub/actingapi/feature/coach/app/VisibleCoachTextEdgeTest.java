package com.acttub.actingapi.feature.coach.app;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.ArrayList;
import java.util.List;

import org.junit.jupiter.api.Test;

/** 스트리밍 글 거르기의 경계: 여는 태그 없이 닫힌 메모, 열리다 만 태그, 메모 이름으로 끝나는 줄, 이미 보낸 글이 숨은 칸이었던 경우. */
class VisibleCoachTextEdgeTest {
    final List<String> out = new ArrayList<>();
    final VisibleCoachText text = new VisibleCoachText(false, out::add);

    @Test void emptyPiecesSendNothing() {
        text.accept(null);
        text.accept("");
        assertThat(out).isEmpty();
        assertThat(text.sent()).isEmpty();
    }

    @Test void everythingBeforeAStrayThinkingCloseIsMemo() {
        assertThat(VisibleCoachText.visible("배우가 원한 건 붙잡기다</생각>그 마음이 먼저였군요.", false)).isEqualTo("그 마음이 먼저였군요.");
        assertThat(VisibleCoachText.visible("메모 하나</think>메모 둘</thinking>보일 말", false)).isEqualTo("보일 말");
    }

    @Test void aHalfOpenedTagIsHeldUntilItCloses() {
        assertThat(VisibleCoachText.visible("말끝이 내려가요. <생", false)).isEqualTo("말끝이 내려가요. ");
        assertThat(VisibleCoachText.visible("말끝이 내려가요. <생각>", false)).isEqualTo("말끝이 내려가요. ");
    }

    @Test void aLastLineThatMayBecomeAMemoIsHeld() {
        assertThat(VisibleCoachText.visible("말끝이 내려가요.\n이번 목표", false)).isEqualTo("말끝이 내려가요.\n");
        assertThat(VisibleCoachText.visible("말끝이 내려가요.\n이번 목표 :", false)).isEqualTo("말끝이 내려가요.\n");
        assertThat(VisibleCoachText.visible("말끝이 내려가요.\n이번 목표는 끝까지 말하기예요.", false))
                .isEqualTo("말끝이 내려가요.\n이번 목표는 끝까지 말하기예요.");
    }

    @Test void onceSentTextTurnsOutHiddenNothingMoreIsSent() {
        text.accept("붙잡고 싶었다");
        assertThat(out).containsExactly("붙잡고 싶었다");
        text.accept("</생각>그 마음이 먼저였군요.");
        assertThat(out).containsExactly("붙잡고 싶었다");
        assertThat(text.sent()).isEqualTo("붙잡고 싶었다");
    }

    @Test void restartKeepsWhatWasAlreadySent() {
        text.accept("말끝이 내려가요.");
        text.restart();
        text.accept("말끝이 내려가요. 다시 해 볼까요?");
        assertThat(String.join("", out)).isEqualTo("말끝이 내려가요. 다시 해 볼까요?");
    }

    @Test void openingWithoutACoachTagShowsNothingYet() {
        assertThat(VisibleCoachText.visible("<설계>\n인물: 떠나는 사람\n", true)).isEmpty();
    }

    @Test void plainTextDropsRulesAndEmptyTableCells() {
        assertThat(PlainCoachText.plain("첫 문단\n---\n* * *\n___\n둘째 문단")).isEqualTo("첫 문단\n둘째 문단");
        assertThat(PlainCoachText.plain("| 앞부분 |  | 차분함 |\n|")).isEqualTo("앞부분 차분함\n|");
        assertThat(PlainCoachText.plain("~~~\n대사\n~~~")).isEqualTo("대사");
    }

    @Test void brokenJamoStopsTheStreamWithoutShowingTheJamo() {
        text.accept("그 장면에서 ");
        text.accept("ㅇㄹㄴ");
        assertThat(String.join("", out)).as("끝에 붙은 자모는 잡아 둔다").isEqualTo("그 장면에서 ");
        assertThatThrownBy(() -> text.accept("ㅁㅇㄹㄴㅁ"))
                .isInstanceOf(VisibleCoachText.Broken.class)
                .satisfies(e -> assertThat(((VisibleCoachText.Broken) e).text()).contains("ㅇㄹㄴㅁ"));
        assertThat(String.join("", out)).doesNotContain("ㅇ");
    }

    @Test void heldJamoIsSentOnceRealTextFollows() {
        text.accept("ㅎ");
        assertThat(out).isEmpty();
        text.accept("하, 거기서 웃었군요.");
        assertThat(String.join("", out)).isEqualTo("ㅎ하, 거기서 웃었군요.");
    }

    @Test void anEnglishQuoteAtTheStartIsNotCutMidStream() {
        text.accept("\"Who knows what she wanted\"에서 ");
        text.accept("고개가 내려가요. 그때 뭘 받고 싶었어요?");
        assertThat(String.join("", out)).isEqualTo("\"Who knows what she wanted\"에서 고개가 내려가요. 그때 뭘 받고 싶었어요?");
    }

    @Test void codeInTheVisibleTextStopsTheStream() {
        text.accept("좋아요. ");
        assertThatThrownBy(() -> text.accept("```java\npublic class X {}"))
                .isInstanceOf(VisibleCoachText.Broken.class);
    }
}
