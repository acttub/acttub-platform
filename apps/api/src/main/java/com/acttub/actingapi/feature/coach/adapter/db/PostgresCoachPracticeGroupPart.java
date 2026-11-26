package com.acttub.actingapi.feature.coach.adapter.db;

import java.util.EnumSet;
import java.util.Set;

import com.acttub.actingapi.feature.practice.app.ErasedPracticeGroup;
import com.acttub.actingapi.feature.practice.app.PracticeGroupErasurePart;
import com.acttub.actingapi.feature.practice.app.PracticeGroupErasureStep;
import jakarta.persistence.EntityManager;
import org.springframework.stereotype.Repository;

/**
 * 연습을 지울 때 그 묶음의 배우 일지와 노트 평가를 정리한다 (practice.library 「연습 삭제」).
 *
 * <p>배우가 직접 쓴 글은 사람과 끊어도 그 사람을 드러낼 수 있어 남기지 않는다(탈퇴와 같다): 일지는 지우고, 노트 평가는 한 줄을
 * 비운 뒤 평가 값만 보관 계정에 넘긴다. 대화와 노트는 회차를 따라가므로 여기서 고치지 않는다.
 *
 * <p>트랜잭션을 열지 않는다 — 연습을 지우는 트랜잭션에 참여한다.
 */
@Repository
class PostgresCoachPracticeGroupPart implements PracticeGroupErasurePart {

    private final EntityManager entityManager;

    PostgresCoachPracticeGroupPart(EntityManager entityManager) {
        this.entityManager = entityManager;
    }

    @Override
    public Set<PracticeGroupErasureStep> steps() {
        return EnumSet.of(PracticeGroupErasureStep.ACTOR_JOURNALS, PracticeGroupErasureStep.NOTE_RATINGS);
    }

    @Override
    public void erase(PracticeGroupErasureStep step, ErasedPracticeGroup group) {
        switch (step) {
            case ACTOR_JOURNALS -> entityManager
                    .createQuery("delete from ActorJournalEntity j where j.practiceId in (:practiceIds)")
                    .setParameter("practiceIds", group.practiceIds())
                    .executeUpdate();
            case NOTE_RATINGS -> entityManager.createQuery("""
                            update NoteRatingEntity r
                            set r.comment = null, r.userId = :keeper, r.updatedAt = :now
                            where r.practiceId in (:practiceIds)
                            """)
                    .setParameter("keeper", group.keeper())
                    .setParameter("now", group.now())
                    .setParameter("practiceIds", group.practiceIds())
                    .executeUpdate();
            default -> throw new IllegalArgumentException("not a coach step: " + step);
        }
    }
}
