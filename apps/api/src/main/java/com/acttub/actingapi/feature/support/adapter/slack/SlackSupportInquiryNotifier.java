package com.acttub.actingapi.feature.support.adapter.slack;

import com.acttub.actingapi.feature.support.app.SupportInquiryNotifier;
import com.acttub.actingapi.integration.slack.SupportSlackChannel;
import java.util.Map;
import org.springframework.stereotype.Component;

/**
 * 새 문의·신고·의견을 Slack 「#문의-신고」 채널에 올린다. 보내기는 {@link SupportSlackChannel} 이 맡는다(주소가 없으면 아무것도
 * 하지 않고, 실패는 로그만). 메일 주소는 메시지에 싣지 않는다. 본문은 앞 {@value #BODY_PREVIEW_CHARS}자만 싣는다.
 */
@Component
public class SlackSupportInquiryNotifier implements SupportInquiryNotifier {
    static final int BODY_PREVIEW_CHARS = 500;
    private static final Map<String, String> LABELS = Map.of(
            "report", "신고", "usage", "사용 문의", "bug", "오류", "billing", "결제",
            "refund", "환불", "account", "계정", "other", "기타", "feedback", "의견");

    private final SupportSlackChannel channel;

    public SlackSupportInquiryNotifier(SupportSlackChannel channel) {
        this.channel = channel;
    }

    @Override
    public void accepted(Notice notice) {
        if (notice == null || !channel.enabled()) {
            return;
        }
        channel.post(message(notice), "inquiry id=" + notice.id());
    }

    /** 첫 줄에 분류(신고는 맨 앞에 표시), 다음 줄에 보낸 곳, 그 아래 본문 앞부분, 마지막에 문의 id. */
    static String message(Notice n) {
        String label = LABELS.getOrDefault(n.category(), n.category());
        boolean report = "report".equals(n.category());
        String from = (n.member() ? "회원" : "비회원") + (n.client() == null || n.client().isBlank() ? " · 웹" : " · 앱 " + n.client());
        return (report ? "*[신고] 24시간 안에 처리*" : "*[" + label + "]*") + " 새 문의가 들어왔어요\n"
                + from + "\n" + SupportSlackChannel.quote(n.body(), BODY_PREVIEW_CHARS) + "\n문의 id `" + n.id() + "`";
    }
}
