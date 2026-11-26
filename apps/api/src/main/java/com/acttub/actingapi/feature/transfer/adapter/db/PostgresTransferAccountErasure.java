package com.acttub.actingapi.feature.transfer.adapter.db;

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
 * 계정을 닫을 때 살아 있는 이관 코드를 지운다 (account.withdraw, account.guest).
 *
 * <p>쓰인 코드는 남긴다. "이 게스트는 옮겨졌다"는 표식이라, 그 게스트의 토큰으로 온 요청에 {@code guest_transferred} 를 답하는
 * 데 쓴다.
 *
 * <p>트랜잭션을 열지 않는다 — 계정을 닫는 트랜잭션에 참여한다.
 */
@Repository
class PostgresTransferAccountErasure implements AccountErasure {

    private final EntityManager entityManager;

    PostgresTransferAccountErasure(EntityManager entityManager) {
        this.entityManager = entityManager;
    }

    @Override
    public Set<AccountErasureStep> steps() {
        return EnumSet.of(AccountErasureStep.TRANSFER_CODES);
    }

    @Override
    public List<UUID> erase(AccountErasureStep step, ClosingAccount account) {
        entityManager.createQuery("delete from GuestTransferCodeEntity c where c.userId = :userId and c.usedAt is null")
                .setParameter("userId", account.userId())
                .executeUpdate();
        return List.of();
    }

    /** 이관 코드는 계정 행과 함께 지워진다({@code ON DELETE CASCADE}). */
    @Override
    public boolean hasRecords(UUID userId) {
        return false;
    }
}
