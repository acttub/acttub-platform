package com.acttub.actingapi.feature.community.adapter.slack;

import com.acttub.actingapi.feature.community.app.CommunityReportNotifier;
import com.acttub.actingapi.integration.slack.SupportSlackChannel;
import java.util.Map;
import org.springframework.stereotype.Component;

/** 커뮤니티 글·댓글 신고를 Slack 「#문의-신고」에 올린다(SOMA-1042). 신고자는 싣지 않고, 신고 메모는 앞 {@value #DETAIL_PREVIEW_CHARS}자만. */
@Component
public class SlackCommunityReportNotifier implements CommunityReportNotifier {
    static final int DETAIL_PREVIEW_CHARS = 300;
    private static final Map<String, String> TARGETS = Map.of("post", "커뮤니티 글", "comment", "커뮤니티 댓글");
    private static final Map<String, String> REASONS = Map.of(
            "spam", "스팸", "abuse", "욕설·괴롭힘", "sexual", "성적인 내용", "privacy", "개인정보", "other", "기타",
            "copyright", "저작권", "inappropriate", "부적절", "duplicate", "중복");

    private final SupportSlackChannel channel;

    public SlackCommunityReportNotifier(SupportSlackChannel channel) {
        this.channel = channel;
    }

    @Override
    public void filed(Notice notice) {
        if (notice == null || !channel.enabled()) {
            return;
        }
        channel.post(message(notice), "community report target=" + notice.targetId());
    }

    static String message(Notice n) {
        String target = TARGETS.getOrDefault(n.targetType(), n.targetType());
        StringBuilder text = new StringBuilder("*[신고 · ").append(target).append("] 24시간 안에 처리* 새 신고가 들어왔어요\n")
                .append("사유: ").append(REASONS.getOrDefault(n.reason(), n.reason())).append('\n');
        if (n.detail() != null && !n.detail().isBlank()) {
            text.append("신고 메모\n").append(SupportSlackChannel.quote(n.detail(), DETAIL_PREVIEW_CHARS)).append('\n');
        }
        return text.append("대상 id `").append(n.targetId()).append('`').toString();
    }
}
