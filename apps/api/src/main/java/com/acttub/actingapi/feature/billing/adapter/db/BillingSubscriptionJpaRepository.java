package com.acttub.actingapi.feature.billing.adapter.db;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

import com.acttub.actingapi.feature.billing.schema.BillingSubscriptionEntity;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;

/** {@code billing_subscriptions} 를 읽고 쓰는 문장. 상태를 바꾸는 조건부 갱신은 모두 한 문장이다(apps/api/CONTRACT.md §5-9). */
interface BillingSubscriptionJpaRepository extends Repository<BillingSubscriptionEntity, UUID> {

    Optional<BillingSubscriptionEntity> findByUserId(UUID userId);

    Optional<BillingSubscriptionEntity> findById(UUID id);

    @Query("select s.userId from BillingSubscriptionEntity s where s.id = :id")
    Optional<UUID> userIdOf(UUID id);

    @Query("select s.id from BillingSubscriptionEntity s where s.userId = :userId")
    Optional<UUID> idOf(UUID userId);

    /**
     * 카드 저장. 회원당 한 행({@code uq_billing_subscriptions_user})이라 있으면 카드·고객 키·{@code updated_at} 만 바꾸고 토스로
     * 되돌리며 스토어 칸을 비운다. 상태·요금제·금액·{@code created_at} 은 둔다.
     */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            insert into BillingSubscriptionEntity (id, userId, status, provider, customerKey, billingKey, cardCompany,
                cardNumber, amount, createdAt, updatedAt)
            values (:id, :userId, 'expired', 'toss', :customerKey, :billingKey, :cardCompany, :cardNumber, :amount, :now, :now)
            on conflict (userId) do update set provider = 'toss', storeProductId = null, storeTransactionId = null,
                billingKey = excluded.billingKey, cardCompany = excluded.cardCompany, cardNumber = excluded.cardNumber,
                customerKey = excluded.customerKey, updatedAt = excluded.updatedAt
            """)
    int saveCard(UUID id, UUID userId, String customerKey, String billingKey, String cardCompany, String cardNumber,
            int amount, Instant now);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            update BillingSubscriptionEntity s set s.plan = :plan, s.amount = :amount, s.updatedAt = :now
            where s.id = :id and s.provider = 'toss' and s.status = 'expired'
            """)
    int choosePlan(UUID id, String plan, int amount, Instant now);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            update BillingSubscriptionEntity s set s.status = 'active', s.currentPeriodStart = :start,
                s.currentPeriodEnd = :end, s.canceledAt = null, s.retryCount = 0, s.nextRetryAt = null, s.updatedAt = :now
            where s.id = :id
            """)
    int activate(UUID id, Instant start, Instant end, Instant now);

    /** 결제하는 동안 해지했으면 해지는 남는다. 기간은 같은 시작에서만 넘긴다. */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            update BillingSubscriptionEntity s
            set s.status = case when s.status = 'canceled' then 'canceled' else 'active' end,
                s.currentPeriodStart = :start, s.currentPeriodEnd = :end, s.retryCount = 0, s.nextRetryAt = null,
                s.updatedAt = :now
            where s.id = :id and s.status in ('active', 'canceled', 'past_due') and s.currentPeriodEnd = :start
            """)
    int advance(UUID id, Instant start, Instant end, Instant now);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            update BillingSubscriptionEntity s set s.status = 'past_due', s.retryCount = :retry, s.nextRetryAt = :next,
                s.updatedAt = :now
            where s.id = :id and s.status in ('active', 'past_due')
            """)
    int markPastDue(UUID id, int retry, Instant next, Instant now);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            update BillingSubscriptionEntity s set s.status = 'expired', s.billingKey = null, s.nextRetryAt = null,
                s.updatedAt = :now
            where s.id = :id
            """)
    int expire(UUID id, Instant now);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            update BillingSubscriptionEntity s set s.billingKey = null, s.updatedAt = :now
            where s.id = :id and s.status = 'expired' and s.billingKey is not null
            """)
    int dropUnpaidKey(UUID id, Instant now);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            update BillingSubscriptionEntity s set s.status = 'canceled', s.canceledAt = :now, s.updatedAt = :now
            where s.id = :id and s.status = 'active'
            """)
    int cancel(UUID id, Instant now);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("update BillingSubscriptionEntity s set s.leaseUntil = null where s.id = :id")
    int release(UUID id);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            update BillingSubscriptionEntity s set s.status = 'expired', s.canceledAt = null, s.updatedAt = :now
            where s.userId = :userId and s.provider in ('apple', 'google') and s.status <> 'expired'
            """)
    int expireStore(UUID userId, Instant now);
}
