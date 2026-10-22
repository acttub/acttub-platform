package com.acttub.actingapi.feature.billing.app;

/**
 * 토스페이먼츠 빌링 API 에 대한 Port. 구현은 {@code adapter.toss} 에 있다.
 *
 * <p>구현은 authKey·billingKey·secretKey 를 반환값·예외 메시지·로그 어디에도 싣지 않는다.
 */
public interface PgReviewGateway {

    /** authKey 를 빌링키로 바꾼다. 빌링키는 호출자가 메모리에서만 쓴다. */
    String issueBillingKey(String authKey, String customerKey);

    /**
     * 빌링키와 함께 토스가 준 카드 표시값(카드사·가린 번호)을 돌려준다(앱 Pro 구독, SOMA-818). 기본 구현은 카드
     * 표시값 없이 {@link #issueBillingKey} 를 부른다.
     */
    default IssuedKey issue(String authKey, String customerKey) {
        return new IssuedKey(issueBillingKey(authKey, customerKey), null, null);
    }

    /** {@code billingKey} 는 비밀 값이다. {@link #toString()} 이 싣지 않는다. */
    record IssuedKey(String billingKey, String cardCompany, String cardNumber) {
        @Override
        public String toString() {
            return "IssuedKey[billingKey=redacted, cardCompany=" + cardCompany + ", cardNumber=" + cardNumber + "]";
        }
    }

    /** 빌링키로 즉시 한 번 승인한다. 같은 {@code idempotencyKey} 는 같은 결제로 취급된다. */
    Approval approve(String billingKey, String customerKey, String orderId, long amount, String orderName,
            String idempotencyKey);

    record Approval(String status, String orderId, long amount, String approvedAt) {
    }

    /** 토스가 거절했거나({@link Outcome#REJECTED}) 결과를 모른다({@link Outcome#UNKNOWN}, 시간 초과 등). */
    final class GatewayException extends RuntimeException {
        public enum Outcome {
            REJECTED,
            UNKNOWN
        }

        private final Outcome outcome;
        private final String code;

        public GatewayException(Outcome outcome, String code) {
            super("pg review gateway " + outcome + " " + code);
            this.outcome = outcome;
            this.code = code;
        }

        public Outcome outcome() {
            return outcome;
        }

        /** 토스의 오류 코드(대문자·숫자·밑줄) 또는 우리 코드. 비밀 값이 아니다. */
        public String code() {
            return code;
        }
    }
}
