package com.acttub.actingapi.feature.feedback.adapter.db;

import java.time.ZoneOffset;
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
        entityManager.createNativeQuery("""
                UPDATE practice_feedback
                SET contact_email=NULL,contact_phone=NULL,
                    sheet_seq=sheet_seq+1,sheet_synced_at=NULL,updated_at=:now
                WHERE user_id=:userId
                  AND (contact_email IS NOT NULL OR contact_phone IS NOT NULL)
                """)
                .setParameter("now", account.now().atOffset(ZoneOffset.UTC))
                .setParameter("userId", account.userId())
                .executeUpdate();
        return List.of();
    }

    /** 의견의 행은 계정 행을 가리킨 채 남는다(외래 키에 ON DELETE 가 없다). */
    @Override
    public boolean hasRecords(UUID userId) {
        return !entityManager.createNativeQuery("SELECT 1 FROM practice_feedback WHERE user_id=:userId LIMIT 1")
                .setParameter("userId", userId)
                .getResultList()
                .isEmpty();
    }
}
