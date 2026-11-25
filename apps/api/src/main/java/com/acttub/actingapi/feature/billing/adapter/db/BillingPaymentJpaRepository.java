package com.acttub.actingapi.feature.billing.adapter.db;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

import com.acttub.actingapi.feature.billing.schema.BillingPaymentEntity;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;

/** {@code billing_payments} 를 읽고 쓰는 문장. 기록·마무리는 한 문장이다(apps/api/CONTRACT.md §5-9). */
interface BillingPaymentJpaRepository extends Repository<BillingPaymentEntity, UUID> {

    /** 같은 주문 번호는 한 번만({@code uq_billing_payments_order}). 1 이면 이번에 넣었다. */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            insert into BillingPaymentEntity (id, subscriptionId, userId, orderId, kind, amount, status, periodStart, periodEnd,
                attempt)
            values (:id, :subscriptionId, :userId, :orderId, :kind, :amount, :status, :periodStart, :periodEnd, :attempt)
            on conflict (orderId) do nothing
            """)
    int insert(UUID id, UUID subscriptionId, UUID userId, String orderId, String kind, int amount, String status,
            Instant periodStart, Instant periodEnd, int attempt);

    Optional<BillingPaymentEntity> findByOrderId(String orderId);

    @Query("select count(p) from BillingPaymentEntity p where p.userId = :userId and p.status not in ('done', 'failed')")
    long countUnresolved(UUID userId);

    Optional<BillingPaymentEntity> findFirstBySubscriptionIdAndPeriodStartOrderByAttemptDesc(UUID subscriptionId,
            Instant periodStart);

    /** done 이 된 결제는 다시 바꾸지 않는다. */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            update BillingPaymentEntity p set p.status = :status, p.approvedAt = :approvedAt, p.failureCode = :code,
                p.updatedAt = :now
            where p.orderId = :orderId and p.status <> 'done'
            """)
    int finish(String orderId, String status, String approvedAt, String code, Instant now);
}
