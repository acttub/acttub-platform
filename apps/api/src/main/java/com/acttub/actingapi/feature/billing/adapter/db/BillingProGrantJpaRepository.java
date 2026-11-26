package com.acttub.actingapi.feature.billing.adapter.db;

import java.time.Instant;
import java.util.UUID;

import com.acttub.actingapi.feature.billing.schema.BillingProGrantEntity;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;

/** {@code billing_pro_grants} 를 읽는 문장. */
interface BillingProGrantJpaRepository extends Repository<BillingProGrantEntity, UUID> {

    /** 지금 걸친 부여 가운데 가장 늦은 끝. 없으면 null. */
    @Query("""
            select max(g.endsAt) from BillingProGrantEntity g
            where g.userId = :userId and g.startsAt <= :now and g.endsAt > :now
            """)
    Instant latestEnd(UUID userId, Instant now);
}
