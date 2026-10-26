package com.acttub.actingapi.feature.billing.app;

import java.time.Instant;
import java.util.Optional;

/**
 * 스토어 구독 조회의 바깥 경계(SOMA-818 2단계). 앱은 RevenueCat SDK 로 사고, 서버는 RevenueCat REST API
 * ({@code GET /v1/subscribers/{app_user_id}})로 현재 상태를 읽는다. 구현은 {@code adapter.store} 에 있고 서비스는 이 Port 와 값만
 * 본다. 테스트는 네트워크 없이 값으로 바로 채운다.
 */
public final class StoreGateways {
    private StoreGateways() {
    }

    /** 스토어 조회 실패. kind 가 응답 코드를 정한다 — INVALID 400·422, UNAVAILABLE 503(설정 없음·키 거부), UPSTREAM 502(RevenueCat·네트워크 오류, 다시 시도). */
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

    /**
     * RevenueCat 고객 정보에서 우리 entitlement(기본 {@code pro})를 준 구독 하나. 시각은 모두 Instant, 없으면 null.
     *
     * @param store RevenueCat 의 store 값(app_store·mac_app_store·play_store·promotional·stripe …). 모르면 null
     * @param productId 상품 ID. Google 은 {@code 구독ID:기본요금제ID} 꼴일 수 있어 앞부분만 둔다
     * @param expiresDate 이번 기간 끝(지났을 수 있음). 평생 상품이면 null
     * @param gracePeriodExpiresDate 결제 유예 끝. 유예에 들어간 적이 없으면 null
     * @param unsubscribeDetectedAt 자동 갱신을 끈 것을 RevenueCat 이 알아챈 때. 다시 켜면 null
     * @param billingIssuesDetectedAt 결제 문제를 알아챈 때. 풀리면 null
     * @param refundedAt 환불을 알아챈 때
     */
    public record StoreSubscription(
            String store,
            String productId,
            Instant purchaseDate,
            Instant expiresDate,
            Instant gracePeriodExpiresDate,
            Instant unsubscribeDetectedAt,
            Instant billingIssuesDetectedAt,
            Instant refundedAt,
            boolean sandbox,
            String storeTransactionId) {
    }

    public interface RevenueCatGateway {
        /** 이 서버가 RevenueCat 조회를 켰는가. 꺼져 있으면 동기화는 503 {@code store_unavailable}. */
        boolean configured();

        /**
         * 이 app_user_id(우리 user id)의 entitlement 를 준 구독. RevenueCat 에 고객이 없거나 entitlement 를 받은 적이 없으면 비어 있다
         * (만료된 entitlement 는 비어 있지 않고 지난 expiresDate 로 온다).
         */
        Optional<StoreSubscription> entitlement(String appUserId);
    }

    /** 꺼진 상태의 구현. */
    public static RevenueCatGateway revenueCatDisabled() {
        return new RevenueCatGateway() {
            @Override
            public boolean configured() {
                return false;
            }

            @Override
            public Optional<StoreSubscription> entitlement(String appUserId) {
                throw new StoreException(StoreException.Kind.UNAVAILABLE, "store_unavailable");
            }
        };
    }
}
