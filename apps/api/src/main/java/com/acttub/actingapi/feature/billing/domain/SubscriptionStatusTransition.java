package com.acttub.actingapi.feature.billing.domain;

/**
 * 구독의 상태({@code billing_subscriptions.status})가 넘어가는 길. 정본은 docs/specs/billing/subscription.md 「상태」다.
 *
 * <p>상태를 바꾸는 UPDATE 는 {@code PostgresBillingStatusTransitions} 한 파일에만 있고, 그 문장들이 이 표와 맞는지
 * {@code StateTransitionTest} 가 본다. 카드를 처음 저장할 때의 첫 상태({@code expired})는 전이가 아니라 여기 없다. 같은 상태로
 * 남는 갱신(기간만 넘기는 {@code active}, 해지해 둔 {@code canceled}, 재시도 횟수만 느는 {@code past_due})도 전이가 아니다.
 *
 * <p>스토어 구독(apple·google)은 RevenueCat 이 말한 상태를 그대로 적는다. 그 upsert 한 문장({@code PostgresBillingRepository#saveStore})은
 * 이 표의 줄에 묶이지 않는다 — 네 상태 사이를 어느 쪽으로든 갈 수 있다.
 */
public enum SubscriptionStatusTransition {
    /** 첫 결제, 또는 끝난 구독을 다시 시작한 첫 결제가 승인됐다. */
    ACTIVATED("expired", "active"),
    /** 실패해 있던 자동결제가 재시도나 새 카드로 승인됐다. */
    RECOVERED("past_due", "active"),
    /** 자동결제가 거절됐다. 하루 뒤 다시 시도한다. */
    PAYMENT_FAILED("active", "past_due"),
    /** 자동결제만 해지했다. 이번 기간 끝까지 Pro 다. */
    CANCELED("active", "canceled"),
    /** 해지해 둔 구독의 기간이 끝났다. */
    ENDED_AFTER_CANCEL("canceled", "expired"),
    /** 재시도를 다 썼거나, 결제가 실패해 있는 동안 해지했다. */
    ENDED_WHILE_PAST_DUE("past_due", "expired"),
    /** 이용 중에 끝났다: 탈퇴, 스토어의 환불이나 권한 없음. */
    ENDED_WHILE_ACTIVE("active", "expired");

    private final String from;
    private final String to;

    SubscriptionStatusTransition(String from, String to) {
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
