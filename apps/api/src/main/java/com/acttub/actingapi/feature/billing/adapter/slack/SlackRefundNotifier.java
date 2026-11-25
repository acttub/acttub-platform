package com.acttub.actingapi.feature.billing.adapter.slack;

import com.acttub.actingapi.feature.billing.app.RefundNotifier;
import com.acttub.actingapi.integration.slack.SupportSlackChannel;
import org.springframework.stereotype.Component;

/**
 * 환불 대상 결제를 Slack 「#문의-신고」에 올린다. 주문 ID 와 금액만 싣는다 — 회원을 알아볼 정보는 싣지 않는다.
 */
@Component
public class SlackRefundNotifier implements RefundNotifier {
    private final SupportSlackChannel channel;

    public SlackRefundNotifier(SupportSlackChannel channel) {
        this.channel = channel;
    }

    @Override
    public void refundNeeded(Refund refund) {
        if (refund == null || !channel.enabled()) {
            return;
        }
        channel.post(message(refund), "refund order=" + refund.orderId());
    }

    static String message(Refund r) {
        return "*[결제 · 환불 대상]* 탈퇴가 끝난 뒤 첫 결제가 승인됐어요. 구독은 열지 않았어요. 토스 관리자에서 이 주문을 환불해 주세요\n"
                + "금액 " + String.format("%,d", r.amount()) + "원 · 주문 id `" + r.orderId() + "`";
    }
}
