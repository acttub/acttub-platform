package com.acttub.actingapi.feature.billing.adapter.db;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

import com.acttub.actingapi.feature.billing.schema.BillingCheckoutEntity;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;

/**
 * {@code billing_checkouts} 를 읽고 쓰는 문장. 상태를 바꾸는 문장(창 집기, 닫기)은 여기 두지 않고
 * {@code PostgresBillingStatusTransitions} 에 모은다.
 */
interface BillingCheckoutJpaRepository extends Repository<BillingCheckoutEntity, UUID> {

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            insert into BillingCheckoutEntity (id, userId, stateHash, purpose, customerKey, orderId, status, expiresAt, plan)
            values (:id, :userId, :stateHash, :purpose, :customerKey, :orderId, 'open', :expiresAt, :plan)
            """)
    int open(UUID id, UUID userId, String stateHash, String purpose, String customerKey, String orderId, Instant expiresAt,
            String plan);

    Optional<BillingCheckoutEntity> findByStateHash(String stateHash);

    @Query("""
            select c from BillingCheckoutEntity c
            where c.stateHash = :stateHash and c.status = 'open' and c.expiresAt > :now
            """)
    Optional<BillingCheckoutEntity> findOpen(String stateHash, Instant now);
}
