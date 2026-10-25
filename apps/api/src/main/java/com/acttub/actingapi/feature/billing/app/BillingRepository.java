package com.acttub.actingapi.feature.billing.app;

import java.time.Duration;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

/**
 * 구독·카드 등록 창·결제 기록의 저장(SOMA-818). 구현은 {@code adapter.db} 의 native SQL 이다.
 *
 * <p>상태를 바꾸는 쓰기는 모두 <b>조건부 갱신</b>이다 — 사용자의 해지와 스케줄러의 자동결제가 겹쳐도 서로의 결과를
 * 덮어쓰지 않는다.
 */
public interface BillingRepository {

    Optional<Subscription> find(UUID userId);

    Optional<Subscription> findById(UUID subscriptionId);

    /** 오늘(한국 시간 {@code since} 이후) 만든 코칭 회차 수와 보관 중인 리딩 대본 수 — 무료 한도 판정용. */
    int coachingSessionsSince(UUID userId, Instant since);

    int scriptCount(UUID userId);

    /**
     * 카드 없이 서버가 준 Pro 기간(billing_pro_grants) 중 지금 유효한 것의 가장 늦은 끝. 없으면 비어 있다. 부여는 SQL·관리
     * 경로로만 하고 이 저장소는 읽기만 한다.
     */
    Optional<Instant> grantEnd(UUID userId, Instant now);

    // ── 카드 등록 창 ────────────────────────────────────────────────

    void openCheckout(Checkout checkout);

    /** 열려 있고 만료되지 않은 창을 processing 으로 한 번만 집는다. 두 번째 호출은 비어 있다. */
    Optional<Checkout> claimCheckout(String stateHash, Instant now);

    /** 열려 있고 만료되지 않은 창을 읽기만 한다(결제 창 페이지). */
    Optional<Checkout> findOpenCheckout(String stateHash, Instant now);

    void finishCheckout(UUID checkoutId, String status, String resultCode, Instant now);

    // ── 구독 ───────────────────────────────────────────────────────

    /**
     * 새 빌링키(암호문)와 카드를 저장한다. 구독 줄이 없으면 expired 로 만든다(첫 결제가 끝나야 active).
     *
     * @return 구독 id
     */
    UUID saveCard(UUID userId, String customerKey, String sealedBillingKey, String cardCompany, String cardNumber,
            Instant now);

    /** 첫 결제 성공 — active 와 새 기간. */
    void activate(UUID subscriptionId, Instant periodStart, Instant periodEnd, Instant now);

    /** 자동결제 성공 — 다음 기간. canceled 는 canceled 로 남고, past_due 는 active 로 돌아간다. */
    void advance(UUID subscriptionId, Instant periodStart, Instant periodEnd, Instant now);

    /** 자동결제 실패. */
    void markPastDue(UUID subscriptionId, int retryCount, Instant nextRetryAt, Instant now);

    /** Pro 끝 — 빌링키를 지운다. */
    void expire(UUID subscriptionId, Instant now);

    /** active 만 canceled 로. 바뀌었으면 true. */
    boolean cancel(UUID subscriptionId, Instant now);

    /**
     * 기간이 지났거나(active·canceled) 다시 시도할 때가 된(past_due) 구독 하나를 점유한다. 결과를 모르는 결제가 있는 구독은
     * 집지 않는다 — 그 결제를 같은 키로 다시 물어 결론이 날 때까지 새로 결제하지 않는다.
     */
    Optional<UUID> claimDue(Instant now, Duration lease);

    void release(UUID subscriptionId);

    // ── 결제 기록 ───────────────────────────────────────────────────

    /** 주문 ID 가 이미 있으면 아무것도 하지 않고 false. */
    boolean insertPayment(Payment payment);

    Optional<Payment> findPayment(String orderId);

    /** 결과를 아직 모르는(pending·unknown) 결제가 있는가 — 있으면 새 구독 결제를 열지 않는다. */
    boolean hasUnresolvedPayment(UUID userId);

    /** 이 구독의 이 기간에 대한 가장 마지막 시도. */
    Optional<Payment> lastPayment(UUID subscriptionId, Instant periodStart);

    void finishPayment(String orderId, String status, String approvedAt, String failureCode, Instant now);

    /** 결과를 모르는 결제 하나를 같은 키로 다시 물을 차례로 집는다(updated_at 을 now 로 미뤄 겹치지 않게). */
    Optional<Payment> claimUnknownPayment(Instant now, Duration quietFor, int maxChecks);

    // ── 스토어 구독(apple·google, 2단계) ─────────────────────────────

    /** 스토어 원거래 ID(apple)·구매 토큰(google)으로 구독 줄을 찾는다. */
    Optional<StoreRow> findStore(String provider, String key);

    /**
     * 이 사람의 구독 줄을 스토어 구독으로 쓴다(사람당 한 줄). 토스로 이용 중인 줄(expired 가 아닌)은 덮지 않고 {@code BLOCKED},
     * 같은 원거래·토큰이 다른 사람 줄에 있으면 {@code TAKEN}.
     */
    StoreSave saveStore(UUID userId, StoreState state, Instant now);

    /** 알림이 알려 준 상태를 같은 원거래·토큰의 줄에 반영한다. 줄이 없으면 false. 같은 값을 다시 써도 결과가 같다(멱등). */
    boolean updateStore(String provider, String key, StoreState state, Instant now);

    enum StoreSave { SAVED, TAKEN, BLOCKED }

    record StoreState(
            String provider,
            String productId,
            String key,
            BillingRules.Status status,
            Instant periodStart,
            Instant periodEnd,
            Instant canceledAt) {
    }

    record StoreRow(UUID subscriptionId, UUID userId, String provider, BillingRules.Status status, Instant periodEnd,
            Instant updatedAt) {
    }

    record Subscription(
            UUID id,
            UUID userId,
            BillingRules.Status status,
            String customerKey,
            String sealedBillingKey,
            String cardCompany,
            String cardNumber,
            long amount,
            Instant periodStart,
            Instant periodEnd,
            Instant canceledAt,
            int retryCount,
            Instant nextRetryAt,
            String provider) {
        public boolean toss() {
            return BillingRules.PROVIDER_TOSS.equals(provider);
        }
    }

    record Checkout(
            UUID id,
            UUID userId,
            String stateHash,
            BillingRules.Purpose purpose,
            String customerKey,
            String orderId,
            Instant expiresAt) {
    }

    record Payment(
            UUID id,
            UUID subscriptionId,
            UUID userId,
            String orderId,
            String kind,
            long amount,
            String status,
            Instant periodStart,
            Instant periodEnd,
            int attempt) {
    }
}
