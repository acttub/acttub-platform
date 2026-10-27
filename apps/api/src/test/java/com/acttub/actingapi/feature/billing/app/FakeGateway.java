package com.acttub.actingapi.feature.billing.app;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.List;

/** 토스를 부르지 않는 게이트웨이. 다음 승인 결과를 차례로 넣어 둔다(비면 승인). */
class FakeGateway implements AppBillingGateway {
    final List<String> approvedOrders = new ArrayList<>();
    final List<String> idempotencyKeys = new ArrayList<>();
    final Deque<RuntimeException> nextFailures = new ArrayDeque<>();
    RuntimeException issueFailure;
    int issued;

    @Override
    public PgReviewGateway.IssuedKey issue(String authKey, String customerKey) {
        if (issueFailure != null) {
            throw issueFailure;
        }
        issued++;
        return new PgReviewGateway.IssuedKey("bk_secret_" + issued, "신한", "43301234****123*");
    }

    @Override
    public PgReviewGateway.Approval approve(String billingKey, String customerKey, String orderId, long amount, String orderName,
            String idempotencyKey) {
        idempotencyKeys.add(idempotencyKey);
        if (!nextFailures.isEmpty()) {
            throw nextFailures.pop();
        }
        approvedOrders.add(orderId);
        return new PgReviewGateway.Approval("DONE", orderId, amount, "2026-10-23T10:00:00+09:00");
    }

    static PgReviewGateway.GatewayException rejected() {
        return new PgReviewGateway.GatewayException(PgReviewGateway.GatewayException.Outcome.REJECTED, "REJECT_CARD_COMPANY");
    }

    static PgReviewGateway.GatewayException unknown() {
        return new PgReviewGateway.GatewayException(PgReviewGateway.GatewayException.Outcome.UNKNOWN, "gateway_unreachable");
    }
}
