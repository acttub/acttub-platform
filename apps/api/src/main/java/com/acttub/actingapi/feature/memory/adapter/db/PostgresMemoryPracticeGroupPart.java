package com.acttub.actingapi.feature.memory.adapter.db;

import java.util.EnumSet;
import java.util.Set;

import com.acttub.actingapi.feature.practice.app.ErasedPracticeGroup;
import com.acttub.actingapi.feature.practice.app.PracticeGroupErasurePart;
import com.acttub.actingapi.feature.practice.app.PracticeGroupErasureStep;
import jakarta.persistence.EntityManager;
import org.springframework.stereotype.Repository;

/**
 * 연습을 지울 때 그 묶음에서 나온 배우 기억을 지운다 (practice.library 「연습 삭제」). 코치가 다시 꺼내지 않게 하려는 것이고,
 * 다른 연습에서 나온 기억은 그대로다.
 *
 * <p>트랜잭션을 열지 않는다 — 연습을 지우는 트랜잭션에 참여한다.
 */
@Repository
class PostgresMemoryPracticeGroupPart implements PracticeGroupErasurePart {

    private final EntityManager entityManager;

    PostgresMemoryPracticeGroupPart(EntityManager entityManager) {
        this.entityManager = entityManager;
    }

    @Override
    public Set<PracticeGroupErasureStep> steps() {
        return EnumSet.of(PracticeGroupErasureStep.ACTOR_MEMORIES);
    }

    @Override
    public void erase(PracticeGroupErasureStep step, ErasedPracticeGroup group) {
        entityManager.createQuery("""
                        delete from ActorMemoryEntity m
                        where m.userId = :userId
                          and (m.sourcePracticeId in (:practiceIds) or m.sceneRootId = :rootId)
                        """)
                .setParameter("userId", group.userId())
                .setParameter("practiceIds", group.practiceIds())
                .setParameter("rootId", group.rootId())
                .executeUpdate();
    }
}
