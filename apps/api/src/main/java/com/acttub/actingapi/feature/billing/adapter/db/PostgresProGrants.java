package com.acttub.actingapi.feature.billing.adapter.db;

import java.time.Instant;
import java.time.ZoneOffset;
import java.util.UUID;

import com.acttub.actingapi.feature.billing.app.ProGrants;
import jakarta.persistence.EntityManager;
import org.springframework.stereotype.Repository;

/**
 * {@link ProGrants} 의 구현. 넣기는 남은 기간의 끝을 같은 문장에서 읽는 {@code INSERT … SELECT} 라 native 로 두고(달 더하기도
 * PostgreSQL 의 {@code interval '1 month'} 그대로), 세기는 HQL 이다. 트랜잭션을 열지 않는다.
 */
@Repository
class PostgresProGrants implements ProGrants {

    private final EntityManager entityManager;

    PostgresProGrants(EntityManager entityManager) {
        this.entityManager = entityManager;
    }

    @Override
    public void grantMonth(UUID userId, String reason, Instant now) {
        entityManager.createNativeQuery("""
                        INSERT INTO billing_pro_grants(id,user_id,starts_at,ends_at,reason)
                        SELECT CAST(:id AS uuid), CAST(:userId AS uuid), base.starts_at, base.starts_at + interval '1 month',
                               CAST(:reason AS text)
                        FROM (SELECT GREATEST(CAST(:now AS timestamptz),
                                              COALESCE((SELECT max(ends_at) FROM billing_pro_grants WHERE user_id=:userId),
                                                       CAST(:now AS timestamptz))) AS starts_at) AS base
                        """)
                .setParameter("id", UUID.randomUUID())
                .setParameter("userId", userId)
                .setParameter("reason", reason)
                .setParameter("now", now.atOffset(ZoneOffset.UTC))
                .executeUpdate();
    }

    @Override
    public int count(UUID userId, String reason) {
        return entityManager.createQuery(
                        "select count(g) from BillingProGrantEntity g where g.userId = :userId and g.reason = :reason",
                        Long.class)
                .setParameter("userId", userId)
                .setParameter("reason", reason)
                .getSingleResult()
                .intValue();
    }
}
