package com.acttub.actingapi.feature.coach.adapter.db;

import java.util.EnumSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import com.acttub.actingapi.feature.auth.app.AccountErasure;
import com.acttub.actingapi.feature.auth.app.AccountErasureStep;
import com.acttub.actingapi.feature.auth.app.ClosingAccount;
import jakarta.persistence.EntityManager;
import org.springframework.stereotype.Repository;

/**
 * 계정을 닫을 때 배우 일지와 노트 평가를 정리한다 (account.withdraw, practice.note).
 *
 * <p>배우 일지(V59)는 배우가 직접 쓴 글(느낌·후기·다음 할 것)을 들고 있어 사람과 끊어 남기지 않고 지운다. 노트 평가는 한
 * 줄(자유 입력)만 비우고 평가 값은 사람과 끊어 남긴다. 평가를 쓰는 쪽이 같은 {@code users} 행을 잡으므로 늦게 온 평가가 한 줄을
 * 되살리지 못한다.
 *
 * <p>트랜잭션을 열지 않는다 — 계정을 닫는 트랜잭션에 참여한다.
 */
@Repository
class PostgresCoachAccountErasure implements AccountErasure {

    private final EntityManager entityManager;

    PostgresCoachAccountErasure(EntityManager entityManager) {
        this.entityManager = entityManager;
    }

    @Override
    public Set<AccountErasureStep> steps() {
        return EnumSet.of(AccountErasureStep.ACTOR_JOURNALS, AccountErasureStep.NOTE_RATINGS);
    }

    @Override
    public List<UUID> erase(AccountErasureStep step, ClosingAccount account) {
        switch (step) {
            case ACTOR_JOURNALS -> entityManager.createQuery("delete from ActorJournalEntity j where j.userId = :userId")
                    .setParameter("userId", account.userId())
                    .executeUpdate();
            case NOTE_RATINGS -> entityManager.createQuery("""
                            update NoteRatingEntity r
                            set r.comment = null, r.updatedAt = :now
                            where r.userId = :userId and r.comment is not null
                            """)
                    .setParameter("now", account.now())
                    .setParameter("userId", account.userId())
                    .executeUpdate();
            default -> throw new IllegalArgumentException("not a coach step: " + step);
        }
        return List.of();
    }
}
