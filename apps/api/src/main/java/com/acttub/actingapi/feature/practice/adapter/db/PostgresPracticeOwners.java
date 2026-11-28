package com.acttub.actingapi.feature.practice.adapter.db;

import java.util.UUID;

import com.acttub.actingapi.feature.practice.app.PracticeOwners;
import jakarta.persistence.EntityManager;
import org.springframework.stereotype.Repository;

@Repository
class PostgresPracticeOwners implements PracticeOwners {

    private final EntityManager entityManager;

    PostgresPracticeOwners(EntityManager entityManager) {
        this.entityManager = entityManager;
    }

    @Override
    public boolean owns(UUID userId, UUID practiceId) {
        return !entityManager.createQuery(
                        "select p.id from PracticeEntity p where p.id = :practiceId and p.userId = :userId", UUID.class)
                .setParameter("practiceId", practiceId)
                .setParameter("userId", userId)
                .getResultList()
                .isEmpty();
    }

    @Override
    public UUID groupOf(UUID userId, UUID practiceId) {
        return entityManager.createQuery(
                        "select p.rootId from PracticeEntity p where p.id = :practiceId and p.userId = :userId", UUID.class)
                .setParameter("practiceId", practiceId)
                .setParameter("userId", userId)
                .getResultList().stream().findFirst().orElse(null);
    }
}
