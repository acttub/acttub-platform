package com.acttub.actingapi.feature.billing.app;

/**
 * 앱 Pro 정기결제(SOMA-818)가 쓰는 토스 자동결제 Port. 값 모양({@link PgReviewGateway.IssuedKey}·{@link PgReviewGateway.Approval}·
 * {@link PgReviewGateway.GatewayException})은 PG 심사 결제와 같고, 구현도 같은 {@code TossBillingGateway} 를 감싼다. 타입을
 * 따로 두는 것은 두 기능의 빈(키·스위치가 다르다)이 섞이지 않게 하려는 것이다.
 */
public interface AppBillingGateway {
    PgReviewGateway.IssuedKey issue(String authKey, String customerKey);

    PgReviewGateway.Approval approve(String billingKey, String customerKey, String orderId, long amount, String orderName,
            String idempotencyKey);
}
