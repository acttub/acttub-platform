package com.acttub.actingapi.feature.push.adapter.db;

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
 * 계정을 닫을 때 푸시 토큰과 푸시 기록 둘을 지운다 (account.withdraw).
 *
 * <p>연습 알림 보낸 기록(V47)과 푸시를 눌러 연 기록(V72)은 사람과 끊어 남기지 않고 지운다.
 *
 * <p>트랜잭션을 열지 않는다 — 계정을 닫는 트랜잭션에 참여한다.
 */
@Repository
class PostgresPushAccountErasure implements AccountErasure {

    private final EntityManager entityManager;

    PostgresPushAccountErasure(EntityManager entityManager) {
        this.entityManager = entityManager;
    }

    @Override
    public Set<AccountErasureStep> steps() {
        return EnumSet.of(AccountErasureStep.PUSH);
    }

    @Override
    public List<UUID> erase(AccountErasureStep step, ClosingAccount account) {
        entityManager.createQuery("delete from PracticeReminderSendEntity s where s.userId = :userId")
                .setParameter("userId", account.userId())
                .executeUpdate();
        // push_opens 는 Schema Entity 가 없어 native 로 둔다.
        entityManager.createNativeQuery("DELETE FROM push_opens WHERE user_id=:userId")
                .setParameter("userId", account.userId())
                .executeUpdate();
        entityManager.createQuery("delete from PushTokenEntity t where t.userId = :userId")
                .setParameter("userId", account.userId())
                .executeUpdate();
        return List.of();
    }

    /** 푸시 토큰과 기록은 계정 행과 함께 지워도 된다. */
    @Override
    public boolean hasRecords(UUID userId) {
        return false;
    }
}
