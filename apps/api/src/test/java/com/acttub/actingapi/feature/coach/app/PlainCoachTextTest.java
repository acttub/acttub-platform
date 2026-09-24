package com.acttub.actingapi.feature.coach.app;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class PlainCoachTextTest {

    @Test void headingsLoseTheirMarkers() {
        assertThat(PlainCoachText.plain("# 전체 인상\n장면이 차분해요.\n### 보완점\n말끝이 흐려요."))
                .isEqualTo("전체 인상\n장면이 차분해요.\n보완점\n말끝이 흐려요.");
    }

    @Test void boldAndStrayMarkersAreRemoved() {
        assertThat(PlainCoachText.plain("**전체 인상**은 좋아요. __사이__가 살아 있어요. 끝** 남음"))
                .isEqualTo("전체 인상은 좋아요. 사이가 살아 있어요. 끝 남음");
    }

    @Test void bulletMarkersAreRemovedButTextKept() {
        assertThat(PlainCoachText.plain("- 말끝을 올려 보세요.\n* 시선을 먼저 옮겨요.\n• 호흡을 짧게 끊어요.\n  - 들여쓴 항목"))
                .isEqualTo("말끝을 올려 보세요.\n시선을 먼저 옮겨요.\n호흡을 짧게 끊어요.\n들여쓴 항목");
    }

    @Test void numberedMarkersAreRemovedButTextKept() {
        assertThat(PlainCoachText.plain("1. 첫 번째 보완점이에요.\n2) 두 번째 보완점이에요."))
                .isEqualTo("첫 번째 보완점이에요.\n두 번째 보완점이에요.");
    }

    @Test void tablesBecomeSpaceJoinedLines() {
        assertThat(PlainCoachText.plain("| 구간 | 느낌 |\n|---|:---:|\n| 앞부분 | 차분함 |"))
                .isEqualTo("구간 느낌\n앞부분 차분함");
    }

    @Test void codeFencesAreRemovedAndInnerTextKept() {
        assertThat(PlainCoachText.plain("다시 해 볼 대사예요.\n```text\n우리 그만하자\n```"))
                .isEqualTo("다시 해 볼 대사예요.\n우리 그만하자");
    }

    @Test void blankRunsCollapseToOneBlankLine() {
        assertThat(PlainCoachText.plain("\n\n첫 문단이에요.\n\n\n\n둘째 문단이에요.  \n\n"))
                .isEqualTo("첫 문단이에요.\n\n둘째 문단이에요.");
    }

    @Test void ordinaryKoreanProseAndQuotedDialogueSurviveUnchanged() {
        String prose = "\"우리 그만하자\"를 말할 때 사이가 좋았어요. 3*4 박자처럼 끊기는 느낌은 없었고, 5.5초쯤 시선이 내려가요.\n\n"
                + "다음엔 '괜찮아?' 앞에서 숨을 한 번 쉬어 보세요. 2026년 촬영본과 비교해도 좋아요.";
        assertThat(PlainCoachText.plain(prose)).isEqualTo(prose);
    }

    @Test void singleAsteriskInsideWordsIsKept() {
        assertThat(PlainCoachText.plain("별*표가 들어간 말도 그대로예요.")).isEqualTo("별*표가 들어간 말도 그대로예요.");
    }

    @Test void fullMarkdownReplyBecomesPlainParagraphs() {
        String markdown = "## **전체 인상**\n\n장면 흐름이 자연스러워요.\n\n"
                + "**보완점**\n- 말끝을 흐리지 말고 끝까지 전달해요.\n- \"우리 그만하자\"에서 사이를 조금 더 두세요.\n\n"
                + "1. **다음 촬영**: 시선을 먼저 옮겨요.";
        String plain = PlainCoachText.plain(markdown);
        assertThat(plain).isEqualTo("전체 인상\n\n장면 흐름이 자연스러워요.\n\n"
                + "보완점\n말끝을 흐리지 말고 끝까지 전달해요.\n\"우리 그만하자\"에서 사이를 조금 더 두세요.\n\n"
                + "다음 촬영: 시선을 먼저 옮겨요.");
        assertThat(plain).doesNotContain("**", "#").doesNotStartWith("- ");
        assertThat(plain.lines()).noneMatch(line -> line.startsWith("- ") || line.matches("\\d+[.)] .*"));
    }

    @Test void blankOrMarkupOnlyInputBecomesEmpty() {
        assertThat(PlainCoachText.plain(null)).isEmpty();
        assertThat(PlainCoachText.plain("  \n\n ")).isEmpty();
        assertThat(PlainCoachText.plain("**\n#\n```\n---\n- ")).isEmpty();
    }
}
