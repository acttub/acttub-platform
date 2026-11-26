package com.acttub.actingapi.feature.practice.adapter.db;

import java.time.Instant;
import java.time.ZoneOffset;
import java.util.UUID;

import com.acttub.actingapi.feature.practice.app.PracticeStageTransitions;
import jakarta.persistence.EntityManager;
import org.springframework.stereotype.Repository;

/**
 * 회차의 단계를 바꾸는 문장은 이 파일에만 둔다({@code StateTransitionTest}). 트랜잭션을 열지 않는다 — 부르는 쪽의 것에 참여한다.
 *
 * <p>회차 id 를 받는 전이만 JPQL 이다. 나머지 셋은 어느 회차인지를 같은 문장에서 다른 기능의 테이블(작업 장부의
 * {@code ai_jobs}, 코치의 {@code coach_conversations})로 고른다 — 먼저 읽어 오면 요청마다 문장이 하나 는다(코치의 답 경로는
 * 문장 수를 고정해 두었다, apps/api/CONTRACT.md §5-9).
 */
@Repository
class PostgresPracticeStageTransitions implements PracticeStageTransitions {

    private final EntityManager entityManager;

    PostgresPracticeStageTransitions(EntityManager entityManager) {
        this.entityManager = entityManager;
    }

    @Override
    public void analysisSaved(UUID practiceId, Instant now) {
        entityManager.createQuery("""
                        update PracticeEntity p set p.stage = 'conversing', p.updatedAt = :now
                        where p.id = :practiceId and p.stage = 'analyzing'
                        """)
                .setParameter("now", now)
                .setParameter("practiceId", practiceId)
                .executeUpdate();
    }

    @Override
    public void analysisFailed(UUID jobId, Instant now) {
        entityManager.createNativeQuery("""
                UPDATE practices
                SET stage='closed',close_reason='analysis_failed',updated_at=:now
                WHERE id=(SELECT target_id FROM ai_jobs WHERE id=:jobId)
                  AND stage='analyzing'
                """)
                .setParameter("now", now.atOffset(ZoneOffset.UTC))
                .setParameter("jobId", jobId)
                .executeUpdate();
    }

    @Override
    public void conversationClosed(UUID conversationId, Instant now) {
        entityManager.createNativeQuery("""
                UPDATE practices SET stage='closed',close_reason='conversation_closed',updated_at=:now
                WHERE id=(SELECT practice_id FROM coach_conversations WHERE id=:conversationId)
                """)
                .setParameter("now", now.atOffset(ZoneOffset.UTC))
                .setParameter("conversationId", conversationId)
                .executeUpdate();
    }

    @Override
    public void cancelled(UUID practiceId, Instant now) {
        entityManager.createQuery("""
                        update PracticeEntity p set p.stage = 'closed', p.closeReason = 'cancelled', p.updatedAt = :now
                        where p.id = :practiceId
                        """)
                .setParameter("now", now)
                .setParameter("practiceId", practiceId)
                .executeUpdate();
    }

    @Override
    public void retried(UUID practiceId, Instant now) {
        entityManager.createQuery("""
                        update PracticeEntity p set p.stage = 'analyzing', p.closeReason = null, p.updatedAt = :now
                        where p.id = :practiceId
                        """)
                .setParameter("now", now)
                .setParameter("practiceId", practiceId)
                .executeUpdate();
    }

    @Override
    public void conversationReopened(UUID conversationId, Instant now) {
        entityManager.createNativeQuery("""
                UPDATE practices SET stage='conversing',close_reason=NULL,updated_at=:now
                WHERE id=(SELECT practice_id FROM coach_conversations WHERE id=:conversationId)
                """)
                .setParameter("now", now.atOffset(ZoneOffset.UTC))
                .setParameter("conversationId", conversationId)
                .executeUpdate();
    }
}
