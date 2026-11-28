package com.acttub.actingapi.feature.practice.adapter.db;

import java.util.UUID;

import com.acttub.actingapi.feature.practice.app.PracticesFromReading;
import jakarta.persistence.EntityManager;
import org.springframework.stereotype.Repository;

/**
 * 트랜잭션 밖에서도 불린다(코치 응답, 리딩 완료 화면). 공유 EntityManager 는 조회가 끝나면 바로 닫히므로 결과를 다 받아 오는
 * {@code getResultList()} 를 쓴다.
 */
@Repository
class PostgresPracticesFromReading implements PracticesFromReading {

    private final EntityManager entityManager;

    PostgresPracticesFromReading(EntityManager entityManager) {
        this.entityManager = entityManager;
    }

    @Override
    public UUID practiceOf(UUID userId, UUID readingSessionId) {
        return entityManager.createQuery(
                        "select p.id from PracticeEntity p where p.userId = :userId and p.readingSessionId = :readingSessionId",
                        UUID.class)
                .setParameter("userId", userId)
                .setParameter("readingSessionId", readingSessionId)
                .getResultList().stream().findFirst().orElse(null);
    }

    @Override
    public UUID readingSessionOf(UUID userId, UUID practiceId) {
        return entityManager.createQuery("""
                        select r.readingSessionId from PracticeEntity p join PracticeEntity r on r.id = p.rootId
                        where p.id = :practiceId and p.userId = :userId and r.readingSessionId is not null
                        """, UUID.class)
                .setParameter("practiceId", practiceId)
                .setParameter("userId", userId)
                .getResultList().stream().findFirst().orElse(null);
    }
}
