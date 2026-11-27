package com.acttub.actingapi.feature.profile.adapter.db;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.profile.app.AirbridgeLookupStore;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Tuple;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/** {@code user_airbridge_device_lookups}(V43)의 재조회 쪽 HQL. 기기 ID 는 이 표에만 있고 지우면 남지 않는다. */
@Repository
class PostgresAirbridgeLookupStore implements AirbridgeLookupStore {
    private final EntityManager entityManager;
    private final TransactionTemplate transaction;

    PostgresAirbridgeLookupStore(EntityManager entityManager, PlatformTransactionManager transactionManager) {
        this.entityManager = entityManager;
        this.transaction = new TransactionTemplate(transactionManager);
    }

    @Override
    public List<Lookup> due(Instant now, int limit) {
        return transaction.execute(status -> entityManager.createQuery("""
                        select l.userId as userId, l.platform as platform, l.deviceUuid as deviceUuid,
                               l.createdAt as createdAt, l.attempts as attempts
                        from UserAirbridgeDeviceLookupEntity l
                        where l.nextAttemptAt <= :now
                        order by l.nextAttemptAt
                        """, Tuple.class)
                .setParameter("now", now)
                .setMaxResults(limit)
                .getResultList().stream()
                .map(row -> new Lookup(
                        row.get("userId", UUID.class),
                        row.get("platform", String.class),
                        row.get("deviceUuid", String.class),
                        row.get("createdAt", Instant.class),
                        row.get("attempts", Integer.class)))
                .toList());
    }

    @Override
    public boolean hasAttribution(UUID userId) {
        return Boolean.TRUE.equals(transaction.execute(status -> !entityManager.createQuery(
                        "select 1 from UserSignupAttributionEntity a where a.userId = :userId", Integer.class)
                .setParameter("userId", userId)
                .getResultList()
                .isEmpty()));
    }

    @Override
    public void delete(UUID userId) {
        transaction.executeWithoutResult(status -> entityManager.createQuery(
                        "delete from UserAirbridgeDeviceLookupEntity l where l.userId = :userId")
                .setParameter("userId", userId)
                .executeUpdate());
    }

    @Override
    public void retryAt(UUID userId, Instant nextAttemptAt) {
        transaction.executeWithoutResult(status -> entityManager.createQuery("""
                        update UserAirbridgeDeviceLookupEntity l
                        set l.attempts = l.attempts + 1, l.nextAttemptAt = :next
                        where l.userId = :userId
                        """)
                .setParameter("userId", userId)
                .setParameter("next", nextAttemptAt)
                .executeUpdate());
    }
}
