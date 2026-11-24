package com.acttub.actingapi.feature.billing.app;

/**
 * 사람이 환불해야 하는 결제를 팀에 알린다(Slack #문의-신고). 자동 환불은 하지 않는다 — 알림을 받은 사람이 토스 관리자에서
 * 환불한다. 지금은 첫 결제 승인을 기다리는 사이에 탈퇴가 끝난 경우 하나다. 알림이 실패해도 결제 흐름은 그대로다 — 구현은
 * 예외를 밖으로 던지지 않는다. 회원을 알아볼 정보(이메일·이름·회원 id)는 넘기지 않는다.
 */
public interface RefundNotifier {

    /** @param orderId 토스 주문 ID — 토스 관리자에서 이 값으로 결제를 찾는다 */
    record Refund(String orderId, long amount) {
    }

    void refundNeeded(Refund refund);

    RefundNotifier NONE = refund -> { };
}
