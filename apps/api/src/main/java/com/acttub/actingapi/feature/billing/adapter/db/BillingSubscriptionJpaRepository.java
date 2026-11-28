package com.acttub.actingapi.feature.billing.adapter.db;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

import com.acttub.actingapi.feature.billing.schema.BillingSubscriptionEntity;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;

/**
 * {@code billing_subscriptions} 를 읽고 쓰는 문장. 상태를 바꾸는 문장은 여기 두지 않고 {@code PostgresBillingStatusTransitions} 에 모은다.
 */
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
            update BillingSubscriptionEntity s set s.billingKey = null, s.updatedAt = :now
            where s.id = :id and s.status = 'expired' and s.billingKey is not null
            """)
    int dropUnpaidKey(UUID id, Instant now);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("update BillingSubscriptionEntity s set s.leaseUntil = null where s.id = :id")
    int release(UUID id);
}
