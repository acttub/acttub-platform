package com.acttub.actingapi.feature.billing.app;

import java.time.Instant;

/**
 * 웹 Pro 결제가 끝났을 때 보내는 구독 메일(SOMA-961) Port. 전자상거래법 제13조 제2항의 계약내용 전자문서로 쓴다 — 상품·금액·결제
 * 시기·다음 결제일·해지·환불·약관·사업자 정보를 한 통에 담는다. 보내기는 결제를 막지 않는다(구현은 실패를 삼킨다).
 */
public interface BillingMailer {
    /** 메일을 끈 상태. 아무것도 보내지 않는다. */
    BillingMailer NONE = mail -> { };

    void paymentDone(PaidMail mail);

    /**
     * @param first        첫 결제면 true, 매달 자동결제면 false
     * @param periodStart  이번 결제로 열린 이용 기간의 시작
     * @param periodEnd    이용 기간의 끝(= 다음 결제일)
     */
    record PaidMail(String to, String name, boolean first, String orderId, long amount, String cardCompany,
            String cardNumber, Instant paidAt, Instant periodStart, Instant periodEnd) {
        @Override
        public String toString() {
            return "PaidMail[to=redacted, first=" + first + ", orderId=" + orderId + ", amount=" + amount + "]";
        }
    }
}
