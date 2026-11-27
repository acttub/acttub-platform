package com.acttub.actingapi.feature.reading.adapter.db;

import java.util.UUID;

import com.acttub.actingapi.feature.reading.app.CompletedReadings;
import com.acttub.actingapi.platform.schema.ReadingSessionStatus;
import jakarta.persistence.EntityManager;
import org.springframework.stereotype.Repository;

/** {@link CompletedReadings} 의 구현. HQL 한 문장이고 트랜잭션을 열지 않는다. */
@Repository
class PostgresCompletedReadings implements CompletedReadings {

    private final EntityManager entityManager;

    PostgresCompletedReadings(EntityManager entityManager) {
        this.entityManager = entityManager;
    }

    @Override
    public boolean completed(UUID userId, UUID sessionId) {
        return !entityManager.createQuery("""
                        select s.id from ReadingSessionEntity s
                        where s.id = :sessionId and s.userId = :userId and s.status = :completed
                        """, UUID.class)
                .setParameter("sessionId", sessionId)
                .setParameter("userId", userId)
                .setParameter("completed", ReadingSessionStatus.COMPLETED)
                .getResultList()
                .isEmpty();
    }
}
