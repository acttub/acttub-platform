package com.acttub.actingapi.feature.practice.adapter.db;

import java.util.UUID;

import com.acttub.actingapi.feature.practice.app.PracticeOwnership;
import jakarta.persistence.EntityManager;
import org.springframework.stereotype.Repository;

/** 게스트의 연습을 회원에게 넘긴다. 옛 {@code practice_sessions} 와 0.1.0 회차를 함께 옮긴다. */
@Repository
class PostgresPracticeOwnership implements PracticeOwnership {
    private final EntityManager entityManager;
    private final PracticeJpaRepository practices;

    PostgresPracticeOwnership(EntityManager entityManager, PracticeJpaRepository practices) {
        this.entityManager = entityManager;
        this.practices = practices;
    }

    /**
     * 분석·대화·노트는 연습 행에 매달려 함께 따라간다.
     *
     * <p>⚠ <b>트랜잭션을 따로 열지 않는다.</b> {@code REQUIRES_NEW} 로 열면 이관의 트랜잭션과 따로 커밋돼,
     * 이관이 도중에 실패해도 연습만 회원에게 넘어간 채로 남는다. 부르는 쪽에 트랜잭션이 없으면
     * {@code executeUpdate} 가 거절한다.
     */
    @Override
    public void reassign(UUID from, UUID to) {
        // 옛 표에 남은 자료(이전 대화·옛 노트)의 주인은 practice_sessions 로 확인한다. 그래서 두 표를 함께 옮긴다 —
        // 이관은 한 트랜잭션이다(specs/practice 「이관·삭제·탈퇴」).
        entityManager.createNativeQuery("UPDATE practice_sessions SET user_id = :to WHERE user_id = :from")
                .setParameter("to", to)
                .setParameter("from", from)
                .executeUpdate();
        practices.reassign(from, to);
    }
}
