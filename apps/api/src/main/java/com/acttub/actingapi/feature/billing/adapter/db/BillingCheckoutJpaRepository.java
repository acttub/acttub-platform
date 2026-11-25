package com.acttub.actingapi.feature.billing.adapter.db;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

import com.acttub.actingapi.feature.billing.schema.BillingCheckoutEntity;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;

/** {@code billing_checkouts} 를 읽고 쓰는 문장. 창 집기는 한 문장이다(apps/api/CONTRACT.md §5-9). */
interface BillingCheckoutJpaRepository extends Repository<BillingCheckoutEntity, UUID> {

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            insert into BillingCheckoutEntity (id, userId, stateHash, purpose, customerKey, orderId, status, expiresAt, plan)
            values (:id, :userId, :stateHash, :purpose, :customerKey, :orderId, 'open', :expiresAt, :plan)
            """)
    int open(UUID id, UUID userId, String stateHash, String purpose, String customerKey, String orderId, Instant expiresAt,
            String plan);

    /** 시한 전의 open 창을 processing 으로 바꾼다. 1 이면 이 요청이 집었다. */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            update BillingCheckoutEntity c set c.status = 'processing', c.updatedAt = :now
            where c.stateHash = :stateHash and c.status = 'open' and c.expiresAt > :now
            """)
    int claim(String stateHash, Instant now);

    Optional<BillingCheckoutEntity> findByStateHash(String stateHash);

    @Query("""
            select c from BillingCheckoutEntity c
            where c.stateHash = :stateHash and c.status = 'open' and c.expiresAt > :now
            """)
    Optional<BillingCheckoutEntity> findOpen(String stateHash, Instant now);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("update BillingCheckoutEntity c set c.status = :status, c.resultCode = :code, c.updatedAt = :now where c.id = :id")
    int finish(UUID id, String status, String code, Instant now);
}
