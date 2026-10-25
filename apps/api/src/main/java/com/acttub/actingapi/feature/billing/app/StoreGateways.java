package com.acttub.actingapi.feature.billing.app;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

/**
 * 스토어 구독 검증의 바깥 경계(SOMA-818 2단계). 구현은 {@code adapter.store} 에 있고 서비스는 이 Port 와 값만 본다.
 * 테스트는 서명·네트워크 없이 값으로 바로 채운다.
 */
public final class StoreGateways {
    private StoreGateways() {
    }

    /** 스토어 검증 실패. kind 가 응답 코드를 정한다 — INVALID 422, UNAVAILABLE 503(설정 없음), UPSTREAM 502(스토어·네트워크 오류, 다시 시도). */
    public static final class StoreException extends RuntimeException {
        public enum Kind { INVALID, UNAVAILABLE, UPSTREAM }

        private final Kind kind;

        public StoreException(Kind kind, String code) {
            super(code);
            this.kind = kind;
        }

        public Kind kind() {
            return kind;
        }
    }

    /** Apple 이 서명한 거래 한 건(JWS 를 검증해 푼 값). 시각은 모두 Instant, 없으면 null. */
    public record AppleTransaction(
            String originalTransactionId,
            String transactionId,
            String productId,
            UUID appAccountToken,
            Instant purchaseDate,
            Instant expiresDate,
            Instant revocationDate,
            /** 갱신 정보에서 온 자동갱신 여부. 모르면 null. */
            Boolean autoRenew,
            Instant gracePeriodExpiresDate,
            boolean billingRetry,
            String environment) {
    }

    /** App Store Server Notifications V2 한 건(서명 검증 끝). transaction 이 없으면 구독과 무관한 알림이다. */
    public record AppleNotification(
            String notificationUuid,
            String type,
            String subtype,
            Instant signedDate,
            AppleTransaction transaction) {
    }

    public interface AppleStoreGateway {
        /** 이 서버가 Apple 검증을 켰는가. 꺼져 있으면 검증은 503 {@code store_unavailable}. */
        boolean configured();

        /** 클라이언트가 보낸 거래 JWS 를 검증한다(Apple 루트 인증서 체인·번들 ID·앱 ID·환경). 갱신 정보는 담기지 않는다. */
        AppleTransaction verifyTransaction(String signedTransaction);

        AppleNotification verifyNotification(String signedPayload);

        /** App Store Server API 로 이 원거래의 최신 상태(갱신 정보 포함)를 묻는다. 키가 없거나 실패하면 비어 있다. */
        Optional<AppleTransaction> latest(String originalTransactionId, String environment);
    }

    /** Google Play 구독(subscriptionsv2.get)의 필요한 값. */
    public record GoogleSubscription(
            String state,
            String productId,
            Instant startTime,
            Instant expiryTime,
            boolean autoRenewing,
            String obfuscatedAccountId,
            String linkedPurchaseToken,
            boolean acknowledged) {
    }

    public interface GoogleStoreGateway {
        boolean configured();

        String packageName();

        GoogleSubscription get(String purchaseToken);

        void acknowledge(String productId, String purchaseToken);
    }

    /** 꺼진 상태의 Apple 구현. */
    public static AppleStoreGateway appleDisabled() {
        return new AppleStoreGateway() {
            @Override
            public boolean configured() {
                return false;
            }

            @Override
            public AppleTransaction verifyTransaction(String signedTransaction) {
                throw new StoreException(StoreException.Kind.UNAVAILABLE, "store_unavailable");
            }

            @Override
            public AppleNotification verifyNotification(String signedPayload) {
                throw new StoreException(StoreException.Kind.UNAVAILABLE, "store_unavailable");
            }

            @Override
            public Optional<AppleTransaction> latest(String originalTransactionId, String environment) {
                return Optional.empty();
            }
        };
    }

    public static GoogleStoreGateway googleDisabled() {
        return new GoogleStoreGateway() {
            @Override
            public boolean configured() {
                return false;
            }

            @Override
            public String packageName() {
                return "";
            }

            @Override
            public GoogleSubscription get(String purchaseToken) {
                throw new StoreException(StoreException.Kind.UNAVAILABLE, "store_unavailable");
            }

            @Override
            public void acknowledge(String productId, String purchaseToken) {
                throw new StoreException(StoreException.Kind.UNAVAILABLE, "store_unavailable");
            }
        };
    }
}
