package com.acttub.actingapi.feature.coach.adapter.db;

import java.util.UUID;

import com.acttub.actingapi.feature.coach.app.NotedPractices;
import jakarta.persistence.EntityManager;
import org.springframework.stereotype.Repository;

/** {@link NotedPractices} 의 구현. HQL 한 문장이고 트랜잭션을 열지 않는다. */
@Repository
class PostgresNotedPractices implements NotedPractices {

    private final EntityManager entityManager;

    PostgresNotedPractices(EntityManager entityManager) {
        this.entityManager = entityManager;
    }

    @Override
    public boolean noted(UUID practiceId) {
        return !entityManager.createQuery("""
                        select n.id from CoachNoteEntity n
                        where n.conversationId in (select c.id from CoachConversationEntity c where c.practiceId = :practiceId)
                        """, UUID.class)
                .setParameter("practiceId", practiceId)
                .setMaxResults(1)
                .getResultList()
                .isEmpty();
    }
}
