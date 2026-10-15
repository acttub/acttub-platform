package com.acttub.actingapi.feature.profile.adapter.db;

import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.profile.app.AirbridgeLookupStore;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Tuple;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/** {@code user_airbridge_device_lookups}(V43)의 native SQL. 기기 ID 는 이 표에만 있고 지우면 남지 않는다. */
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
        return transaction.execute(status -> {
            @SuppressWarnings("unchecked")
            List<Tuple> rows = entityManager.createNativeQuery("""
                    SELECT user_id, platform, device_uuid, created_at, attempts
                    FROM user_airbridge_device_lookups
                    WHERE next_attempt_at<=:now
                    ORDER BY next_attempt_at
                    LIMIT :limit
                    """, Tuple.class)
                    .setParameter("now", now.atOffset(ZoneOffset.UTC))
                    .setParameter("limit", limit)
                    .getResultList();
            return rows.stream()
                    .map(row -> new Lookup(
                            row.get("user_id", UUID.class),
                            row.get("platform", String.class),
                            row.get("device_uuid", String.class),
                            row.get("created_at", java.time.OffsetDateTime.class).toInstant(),
                            row.get("attempts", Number.class).intValue()))
                    .toList();
        });
    }

    @Override
    public boolean hasAttribution(UUID userId) {
        return Boolean.TRUE.equals(transaction.execute(status -> !entityManager.createNativeQuery(
                "SELECT 1 FROM user_signup_attributions WHERE user_id=:userId")
                .setParameter("userId", userId)
                .getResultList()
                .isEmpty()));
    }

    @Override
    public void delete(UUID userId) {
        transaction.executeWithoutResult(status -> entityManager.createNativeQuery(
                "DELETE FROM user_airbridge_device_lookups WHERE user_id=:userId")
                .setParameter("userId", userId)
                .executeUpdate());
    }

    @Override
    public void retryAt(UUID userId, Instant nextAttemptAt) {
        transaction.executeWithoutResult(status -> entityManager.createNativeQuery("""
                UPDATE user_airbridge_device_lookups
                SET attempts=attempts+1, next_attempt_at=:next
                WHERE user_id=:userId
                """)
                .setParameter("userId", userId)
                .setParameter("next", nextAttemptAt.atOffset(ZoneOffset.UTC))
                .executeUpdate());
    }
}
