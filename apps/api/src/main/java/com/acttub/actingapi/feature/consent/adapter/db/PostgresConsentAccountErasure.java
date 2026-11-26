package com.acttub.actingapi.feature.consent.adapter.db;

import java.util.List;
import java.util.Set;
import java.util.UUID;

import com.acttub.actingapi.feature.auth.app.AccountErasure;
import com.acttub.actingapi.feature.auth.app.AccountErasureStep;
import com.acttub.actingapi.feature.auth.app.ClosingAccount;
import jakarta.persistence.EntityManager;
import org.springframework.stereotype.Repository;

/**
 * 계정을 닫을 때 동의 기록에서 하는 일 (account.withdraw, account.profile).
 *
 * <p>탈퇴는 동의 기록을 그대로 남긴다 — 맡는 자리가 없다. 자료가 없는 만 14세 미만 계정을 행째 지울 때만 그 계정의 동의 기록을
 * 지운다.
 *
 * <p>트랜잭션을 열지 않는다 — 계정을 닫는 트랜잭션에 참여한다.
 */
@Repository
class PostgresConsentAccountErasure implements AccountErasure {

    private final EntityManager entityManager;

    PostgresConsentAccountErasure(EntityManager entityManager) {
        this.entityManager = entityManager;
    }

    @Override
    public Set<AccountErasureStep> steps() {
        return Set.of();
    }

    @Override
    public List<UUID> erase(AccountErasureStep step, ClosingAccount account) {
        throw new IllegalArgumentException("not a consent step: " + step);
    }

    /** 동의 기록은 계정 그 자체라 계정 행과 함께 지워도 된다. */
    @Override
    public boolean hasRecords(UUID userId) {
        return false;
    }

    /** 동의 기록은 외래 키가 따라 지워 주지 않는다. */
    @Override
    public void eraseWithAccountRow(UUID userId) {
        entityManager.createQuery("delete from UserConsentEntity c where c.userId = :userId")
                .setParameter("userId", userId)
                .executeUpdate();
    }
}
