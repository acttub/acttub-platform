package com.acttub.actingapi.feature.feedback.adapter.db;

import java.time.ZoneOffset;
import java.util.EnumSet;
import java.util.Set;

import com.acttub.actingapi.feature.practice.app.ErasedPracticeGroup;
import com.acttub.actingapi.feature.practice.app.PracticeGroupErasurePart;
import com.acttub.actingapi.feature.practice.app.PracticeGroupErasureStep;
import jakarta.persistence.EntityManager;
import org.springframework.stereotype.Repository;

/**
 * 연습을 지울 때 그 묶음의 의견에서 연락처를 비우고 본문은 보관 계정에 넘긴다 (practice.library 「연습 삭제」, practice.feedback).
 *
 * <p>순번을 올려 시트에도 다시 보내게 한다. 트랜잭션을 열지 않는다 — 연습을 지우는 트랜잭션에 참여한다.
 */
@Repository
class PostgresFeedbackPracticeGroupPart implements PracticeGroupErasurePart {

    private final EntityManager entityManager;

    PostgresFeedbackPracticeGroupPart(EntityManager entityManager) {
        this.entityManager = entityManager;
    }

    @Override
    public Set<PracticeGroupErasureStep> steps() {
        return EnumSet.of(PracticeGroupErasureStep.PRACTICE_FEEDBACK);
    }

    @Override
    public void erase(PracticeGroupErasureStep step, ErasedPracticeGroup group) {
        entityManager.createNativeQuery("""
                UPDATE practice_feedback
                SET contact_email=NULL,contact_phone=NULL,user_id=:keeper,
                    sheet_seq=sheet_seq+1,sheet_synced_at=NULL,updated_at=:now
                WHERE practice_id IN (:practiceIds)
                """)
                .setParameter("keeper", group.keeper())
                .setParameter("now", group.now().atOffset(ZoneOffset.UTC))
                .setParameter("practiceIds", group.practiceIds())
                .executeUpdate();
    }
}
