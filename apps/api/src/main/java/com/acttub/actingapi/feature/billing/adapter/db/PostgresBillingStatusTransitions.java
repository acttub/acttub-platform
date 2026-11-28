package com.acttub.actingapi.feature.billing.adapter.db;

import java.time.Instant;
import java.util.UUID;

import jakarta.persistence.EntityManager;
import jakarta.persistence.Query;
import org.springframework.stereotype.Repository;

/**
 * 구독의 상태({@code billing_subscriptions.status})와 카드 등록 창의 상태({@code billing_checkouts.status})를 바꾸는 UPDATE 는 이
 * 파일에만 둔다({@code StateTransitionTest}). 허용되는 길은 {@code SubscriptionStatusTransition}·{@code CheckoutStatusTransition}
 * 에 있다. 트랜잭션을 열지 않는다 — 부르는 쪽의 것에 참여한다.
 *
 * <p>조건은 SQL 에 그대로 둔다. 조건부 UPDATE 한 문장이 경합에서 진 요청을 0행으로 돌려보낸다(apps/api/CONTRACT.md §5-2).
 *
 * <p>스토어 구독의 upsert({@code PostgresBillingRepository#saveStore})는 여기 없다. 활성 계정인지 보려고 {@code users} 를 함께 읽는
 * 한 문장이라 그 조회가 이미 있는 저장소에 남는다(docs/ARCHITECTURE.md 「테이블 주인」의 읽기 전용 목록에 줄을 더하지 않는다).
 */
@Repository
class PostgresBillingStatusTransitions {

    private final EntityManager entityManager;

    PostgresBillingStatusTransitions(EntityManager entityManager) {
        this.entityManager = entityManager;
    }

    // ── 구독 ──────────────────────────────────────────────

    int activate(UUID id, Instant start, Instant end, Instant now) {
        return modify(entityManager.createQuery("""
                        update BillingSubscriptionEntity s set s.status = 'active', s.currentPeriodStart = :start,
                            s.currentPeriodEnd = :end, s.canceledAt = null, s.retryCount = 0, s.nextRetryAt = null, s.updatedAt = :now
                        where s.id = :id
                        """)
                .setParameter("start", start)
                .setParameter("end", end)
                .setParameter("now", now)
                .setParameter("id", id));
    }

    /** 결제하는 동안 해지했으면 해지는 남는다. 기간은 같은 시작에서만 넘긴다. */
    int advance(UUID id, Instant start, Instant end, Instant now) {
        return modify(entityManager.createQuery("""
                        update BillingSubscriptionEntity s
                        set s.status = case when s.status = 'canceled' then 'canceled' else 'active' end,
                            s.currentPeriodStart = :start, s.currentPeriodEnd = :end, s.retryCount = 0, s.nextRetryAt = null,
                            s.updatedAt = :now
                        where s.id = :id and s.status in ('active', 'canceled', 'past_due') and s.currentPeriodEnd = :start
                        """)
                .setParameter("start", start)
                .setParameter("end", end)
                .setParameter("now", now)
                .setParameter("id", id));
    }

    int markPastDue(UUID id, int retry, Instant next, Instant now) {
        return modify(entityManager.createQuery("""
                        update BillingSubscriptionEntity s set s.status = 'past_due', s.retryCount = :retry, s.nextRetryAt = :next,
                            s.updatedAt = :now
                        where s.id = :id and s.status in ('active', 'past_due')
                        """)
                .setParameter("retry", retry)
                .setParameter("next", next)
                .setParameter("now", now)
                .setParameter("id", id));
    }

    int expire(UUID id, Instant now) {
        return modify(entityManager.createQuery("""
                        update BillingSubscriptionEntity s set s.status = 'expired', s.billingKey = null, s.nextRetryAt = null,
                            s.updatedAt = :now
                        where s.id = :id
                        """)
                .setParameter("now", now)
                .setParameter("id", id));
    }

    int cancel(UUID id, Instant now) {
        return modify(entityManager.createQuery("""
                        update BillingSubscriptionEntity s set s.status = 'canceled', s.canceledAt = :now, s.updatedAt = :now
                        where s.id = :id and s.status = 'active'
                        """)
                .setParameter("now", now)
                .setParameter("id", id));
    }

    int expireStore(UUID userId, Instant now) {
        return modify(entityManager.createQuery("""
                        update BillingSubscriptionEntity s set s.status = 'expired', s.canceledAt = null, s.updatedAt = :now
                        where s.userId = :userId and s.provider in ('apple', 'google') and s.status <> 'expired'
                        """)
                .setParameter("now", now)
                .setParameter("userId", userId));
    }

    /** 탈퇴: 더 결제하지 않게 끝내고 빌링키를 지운다. 계정을 닫는 트랜잭션의 문장 순서를 지키려고 먼저 내보내거나 비우지 않는다. */
    void expireForWithdrawal(UUID userId) {
        entityManager.createQuery("""
                        update BillingSubscriptionEntity s
                        set s.status = 'expired', s.billingKey = null, s.nextRetryAt = null, s.updatedAt = instant
                        where s.userId = :userId
                        """)
                .setParameter("userId", userId)
                .executeUpdate();
    }

    // ── 카드 등록 창 ──────────────────────────────────────────

    /** 시한 전의 open 창을 processing 으로 바꾼다. 1 이면 이 요청이 집었다. */
    int claimCheckout(String stateHash, Instant now) {
        return modify(entityManager.createQuery("""
                        update BillingCheckoutEntity c set c.status = 'processing', c.updatedAt = :now
                        where c.stateHash = :stateHash and c.status = 'open' and c.expiresAt > :now
                        """)
                .setParameter("now", now)
                .setParameter("stateHash", stateHash));
    }

    /** @param status 콜백의 결과: {@code done}·{@code failed}·{@code unknown}·{@code canceled} */
    int finishCheckout(UUID id, String status, String code, Instant now) {
        return modify(entityManager.createQuery(
                        "update BillingCheckoutEntity c set c.status = :status, c.resultCode = :code, c.updatedAt = :now where c.id = :id")
                .setParameter("status", status)
                .setParameter("code", code)
                .setParameter("now", now)
                .setParameter("id", id));
    }

    /** 탈퇴: 열린 창을 닫는다. 위 {@link #expireForWithdrawal} 과 같은 까닭으로 먼저 내보내거나 비우지 않는다. */
    void closeOpenCheckoutsForWithdrawal(UUID userId) {
        entityManager.createQuery(
                        "update BillingCheckoutEntity c set c.status = 'failed' where c.userId = :userId and c.status = 'open'")
                .setParameter("userId", userId)
                .executeUpdate();
    }

    /**
     * 고치기 전에 밀린 변경을 내보내고 고친 뒤 영속성 컨텍스트를 비운다 — 같은 트랜잭션의 다음 조회가 고친 행을 DB 에서 다시 읽는다
     * (Spring Data 의 {@code @Modifying(flushAutomatically = true, clearAutomatically = true)} 와 같다).
     */
    private int modify(Query update) {
        entityManager.flush();
        int changed = update.executeUpdate();
        entityManager.clear();
        return changed;
    }
}
