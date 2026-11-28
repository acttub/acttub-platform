package com.acttub.actingapi.feature.feedback.adapter.db;

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
 * 계정을 닫을 때 의견의 연락처를 비운다 (account.withdraw, practice.feedback).
 *
 * <p>순번을 올려 시트에도 다시 보내게 한다. 본문은 사람과 끊어 남는다.
 *
 * <p>트랜잭션을 열지 않는다 — 계정을 닫는 트랜잭션에 참여한다.
 */
@Repository
class PostgresFeedbackAccountErasure implements AccountErasure {

    private final EntityManager entityManager;

    PostgresFeedbackAccountErasure(EntityManager entityManager) {
        this.entityManager = entityManager;
    }

    @Override
    public Set<AccountErasureStep> steps() {
        return EnumSet.of(AccountErasureStep.PRACTICE_FEEDBACK);
    }

    @Override
    public List<UUID> erase(AccountErasureStep step, ClosingAccount account) {
        entityManager.createQuery("""
                update PracticeFeedbackEntity f
                set f.contactEmail = null, f.contactPhone = null,
                    f.sheetSeq = f.sheetSeq + 1, f.sheetSyncedAt = null, f.updatedAt = :now
                where f.userId = :userId
                  and (f.contactEmail is not null or f.contactPhone is not null)
                """)
                .setParameter("now", account.now())
                .setParameter("userId", account.userId())
                .executeUpdate();
        return List.of();
    }
}
