package com.acttub.actingapi.feature.billing.domain;

/**
 * 카드 등록 창의 상태({@code billing_checkouts.status})가 넘어가는 길. 정본은 docs/specs/billing/subscription.md 다.
 *
 * <p>상태를 바꾸는 UPDATE 는 {@code PostgresBillingStatusTransitions} 한 파일에만 있고, 그 문장들이 이 표와 맞는지
 * {@code StateTransitionTest} 가 본다. 창을 열 때의 첫 상태({@code open})는 전이가 아니라 여기 없다. 끝 상태에서 나가는 길은 없다 —
 * 다시 결제하려면 새 창을 연다.
 */
public enum CheckoutStatusTransition {
    /** 콜백이 창을 집었다. 시한 전의 열린 창을 한 요청만 집는다. */
    CLAIMED("open", "processing"),
    /** 카드 등록과 첫 결제(또는 카드 바꾸기)가 끝났다. */
    DONE("processing", "done"),
    /** 빌링키 발급이나 결제가 거절됐다. */
    FAILED("processing", "failed"),
    /** 결제 결과를 모른다. 같은 주문 번호로 다시 묻는다. */
    UNKNOWN("processing", "unknown"),
    /** 사용자가 결제창에서 취소했다. */
    CANCELED("processing", "canceled"),
    /** 탈퇴가 열린 창을 닫았다. */
    CLOSED_BY_WITHDRAWAL("open", "failed");

    private final String from;
    private final String to;

    CheckoutStatusTransition(String from, String to) {
        this.from = from;
        this.to = to;
    }

    public String from() {
        return from;
    }

    public String to() {
        return to;
    }
}
