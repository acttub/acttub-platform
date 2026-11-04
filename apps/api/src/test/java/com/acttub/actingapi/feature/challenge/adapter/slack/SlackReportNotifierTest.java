package com.acttub.actingapi.feature.challenge.adapter.slack;

import static org.assertj.core.api.Assertions.assertThat;

import com.acttub.actingapi.feature.challenge.app.ReportNotifier.Notice;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class SlackReportNotifierTest {
    private static final UUID ID = UUID.fromString("00000000-0000-0000-0000-000000000001");
    private static final UUID TARGET = UUID.fromString("00000000-0000-0000-0000-000000000002");

    @Test
    void challengeReportShowsReasonLineAndIds() {
        String text = SlackReportNotifier.message(new Notice(ID, "challenge", TARGET, "copyright", null, "사귈 땐 두 사람이\n동의해야"));
        assertThat(text).startsWith("*[신고 · 챌린지] 24시간 안에 처리*")
                .contains("사유: 저작권")
                .contains("챌린지 내용\n> 사귈 땐 두 사람이\n> 동의해야")
                .contains(TARGET.toString()).contains(ID.toString())
                .doesNotContain("신고 메모");
    }

    @Test
    void noteIsQuotedAndLongTextIsCut() {
        String text = SlackReportNotifier.message(new Notice(ID, "comment", TARGET, "other", "욕이 섞였어요", "가".repeat(400)));
        assertThat(text).startsWith("*[신고 · 댓글]").contains("사유: 기타").contains("신고 메모\n> 욕이 섞였어요").contains("…");
        assertThat(text).doesNotContain("가".repeat(301));
    }

    @Test
    void entryWithoutCaptionSkipsContentBlock() {
        String text = SlackReportNotifier.message(new Notice(ID, "entry", TARGET, "inappropriate", null, null));
        assertThat(text).startsWith("*[신고 · 참여작]").contains("사유: 부적절").doesNotContain("내용\n");
    }
}
