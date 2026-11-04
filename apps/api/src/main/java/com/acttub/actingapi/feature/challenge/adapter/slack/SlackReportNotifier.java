package com.acttub.actingapi.feature.challenge.adapter.slack;

import com.acttub.actingapi.feature.challenge.app.ReportNotifier;
import com.acttub.actingapi.integration.slack.SupportSlackChannel;
import java.util.Map;
import org.springframework.stereotype.Component;

/**
 * 앱 안 신고(참여작·댓글·챌린지)를 Slack 「#문의-신고」에 올린다(SOMA-1042). 신고자는 싣지 않고, 대상 글은 앞
 * {@value #TEXT_PREVIEW_CHARS}자, 신고 메모는 앞 {@value #NOTE_PREVIEW_CHARS}자만 싣는다.
 */
@Component
public class SlackReportNotifier implements ReportNotifier {
    static final int TEXT_PREVIEW_CHARS = 300;
    static final int NOTE_PREVIEW_CHARS = 300;
    private static final Map<String, String> TARGETS = Map.of("entry", "참여작", "comment", "댓글", "challenge", "챌린지");
    private static final Map<String, String> REASONS = Map.of(
            "copyright", "저작권", "inappropriate", "부적절", "spam", "스팸", "duplicate", "중복", "other", "기타");

    private final SupportSlackChannel channel;

    public SlackReportNotifier(SupportSlackChannel channel) {
        this.channel = channel;
    }

    @Override
    public void filed(Notice notice) {
        if (notice == null || !channel.enabled()) {
            return;
        }
        channel.post(message(notice), "report id=" + notice.id());
    }

    /** 첫 줄에 대상 종류, 다음 줄에 사유, 그 아래 대상 글과 신고 메모, 마지막에 대상·신고 id. */
    static String message(Notice n) {
        String target = TARGETS.getOrDefault(n.targetType(), n.targetType());
        StringBuilder text = new StringBuilder("*[신고 · ").append(target).append("] 24시간 안에 처리* 새 신고가 들어왔어요\n")
                .append("사유: ").append(REASONS.getOrDefault(n.reason(), n.reason())).append('\n');
        if (n.targetText() != null && !n.targetText().isBlank()) {
            text.append(target).append(" 내용\n").append(SupportSlackChannel.quote(n.targetText(), TEXT_PREVIEW_CHARS)).append('\n');
        }
        if (n.note() != null && !n.note().isBlank()) {
            text.append("신고 메모\n").append(SupportSlackChannel.quote(n.note(), NOTE_PREVIEW_CHARS)).append('\n');
        }
        return text.append("대상 id `").append(n.targetId()).append("` · 신고 id `").append(n.id()).append('`').toString();
    }
}
