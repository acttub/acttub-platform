package com.acttub.actingapi.platform.operation;

import java.time.ZoneOffset;
import java.util.EnumSet;
import java.util.Set;

import com.acttub.actingapi.feature.practice.app.ErasedPracticeGroup;
import com.acttub.actingapi.feature.practice.app.PracticeGroupErasurePart;
import com.acttub.actingapi.feature.practice.app.PracticeGroupErasureStep;
import jakarta.persistence.EntityManager;
import org.springframework.stereotype.Repository;

/**
 * 연습을 지울 때 그 묶음의 AI 작업을 닫고 사람과 끊는다 (practice.library 「연습 삭제」, apps/api/CONTRACT.md §5-7).
 *
 * <p>진행 중인 분석·기억 갱신은 실패로 닫는다. lease 를 떼므로 돌던 워커의 완료는 lease 가 맞지 않아 저장되지 않는다. 그 뒤
 * 작업 행의 주인을 보관 계정으로 바꾼다. 작업의 대상은 회차이거나 그 회차의 코치 대화다 — 대화는 한 문장 안에서 코치의 표를
 * 읽어 고른다.
 *
 * <p>트랜잭션을 열지 않는다 — 연습을 지우는 트랜잭션에 참여한다.
 */
@Repository
class PostgresOperationPracticeGroupPart implements PracticeGroupErasurePart {

    private final EntityManager entityManager;

    PostgresOperationPracticeGroupPart(EntityManager entityManager) {
        this.entityManager = entityManager;
    }

    @Override
    public Set<PracticeGroupErasureStep> steps() {
        return EnumSet.of(PracticeGroupErasureStep.AI_JOBS);
    }

    @Override
    public void erase(PracticeGroupErasureStep step, ErasedPracticeGroup group) {
        entityManager.createNativeQuery("""
                UPDATE ai_jobs
                SET status='failed',failure_reason='practice_deleted',
                    lease_token=NULL,lease_expires_at=NULL,result=NULL,updated_at=:now
                WHERE user_id=:userId
                  AND status IN ('pending','running')
                  AND (target_id IN (:practiceIds)
                       OR target_id IN (SELECT id FROM coach_conversations WHERE practice_id IN (:practiceIds)))
                """)
                .setParameter("now", group.now().atOffset(ZoneOffset.UTC))
                .setParameter("userId", group.userId())
                .setParameter("practiceIds", group.practiceIds())
                .executeUpdate();
        entityManager.createNativeQuery("""
                UPDATE ai_jobs
                SET user_id=:keeper,updated_at=:now
                WHERE user_id=:userId
                  AND (target_id IN (:practiceIds)
                       OR target_id IN (SELECT id FROM coach_conversations WHERE practice_id IN (:practiceIds)))
                """)
                .setParameter("keeper", group.keeper())
                .setParameter("now", group.now().atOffset(ZoneOffset.UTC))
                .setParameter("userId", group.userId())
                .setParameter("practiceIds", group.practiceIds())
                .executeUpdate();
    }
}
