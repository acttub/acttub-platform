package com.acttub.actingapi.feature.community.adapter.slack;

import static org.assertj.core.api.Assertions.assertThat;

import com.acttub.actingapi.feature.community.app.CommunityReportNotifier.Notice;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class SlackCommunityReportNotifierTest {
    private static final UUID TARGET = UUID.fromString("00000000-0000-0000-0000-000000000002");

    @Test
    void postReportShowsReasonDetailAndTarget() {
        String text = SlackCommunityReportNotifier.message(new Notice("post", TARGET, "abuse", "제 얘기를 써놨어요"));
        assertThat(text).startsWith("*[신고 · 커뮤니티 글] 24시간 안에 처리*")
                .contains("사유: 욕설·괴롭힘").contains("신고 메모\n> 제 얘기를 써놨어요").contains(TARGET.toString());
    }

    @Test
    void emptyDetailIsLeftOut() {
        String text = SlackCommunityReportNotifier.message(new Notice("comment", TARGET, "spam", " "));
        assertThat(text).startsWith("*[신고 · 커뮤니티 댓글]").contains("사유: 스팸").doesNotContain("신고 메모");
    }
}
