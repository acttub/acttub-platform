package com.acttub.actingapi.feature.billing.app;

import com.fasterxml.jackson.annotation.JsonInclude;

/** 서버가 믿는 안전한 결과. 카드·키 값은 어느 칸에도 없다. */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record PgReviewResult(
        String status,
        boolean testOnly,
        long amount,
        String orderId,
        String approvedAt,
        String errorCode,
        String message) {

    public static final long AMOUNT = 3900L;

    public static PgReviewResult idle() {
        return new PgReviewResult("idle", true, AMOUNT, null, null, null, null);
    }

    public static PgReviewResult processing(String orderId) {
        return new PgReviewResult("processing", true, AMOUNT, orderId, null, null, null);
    }

    public static PgReviewResult approved(String orderId, String approvedAt) {
        return new PgReviewResult("approved", true, AMOUNT, orderId, approvedAt, null,
                "테스트 결제가 승인되었습니다. 실제 구독 권한은 부여되지 않습니다.");
    }

    public static PgReviewResult failed(String orderId, String errorCode, String message) {
        return new PgReviewResult("failed", true, AMOUNT, orderId, null, errorCode, message);
    }

    public static PgReviewResult unknown(String orderId, String errorCode) {
        return new PgReviewResult("unknown", true, AMOUNT, orderId, null, errorCode,
                "결과를 확인하지 못했습니다. 자동으로 다시 결제하지 않습니다.");
    }
}
