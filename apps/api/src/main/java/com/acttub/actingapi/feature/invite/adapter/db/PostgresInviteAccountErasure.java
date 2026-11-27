package com.acttub.actingapi.feature.invite.adapter.db;

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
 * 계정을 닫을 때 친구 초대에서 하는 일 (account.withdraw, SOMA-865). 내 초대 코드와 내가 넣은 초대 기록은 지우고, 내가 초대한
 * 사람의 기록에서는 나를 뗀다 — 그 사람의 기록은 남아야 다른 코드를 다시 넣지 못한다.
 *
 * <p>트랜잭션을 열지 않는다 — 계정을 닫는 트랜잭션에 참여한다.
 */
@Repository
class PostgresInviteAccountErasure implements AccountErasure {

    private final EntityManager entityManager;

    PostgresInviteAccountErasure(EntityManager entityManager) {
        this.entityManager = entityManager;
    }

    @Override
    public Set<AccountErasureStep> steps() {
        return EnumSet.of(AccountErasureStep.INVITES);
    }

    @Override
    public List<UUID> erase(AccountErasureStep step, ClosingAccount account) {
        if (step != AccountErasureStep.INVITES) {
            throw new IllegalArgumentException("not an invite step: " + step);
        }
        UUID userId = account.userId();
        entityManager.createQuery("delete from InviteCodeEntity c where c.userId = :userId")
                .setParameter("userId", userId)
                .executeUpdate();
        entityManager.createQuery("delete from InviteRedemptionEntity r where r.inviteeId = :userId")
                .setParameter("userId", userId)
                .executeUpdate();
        entityManager.createQuery("update InviteRedemptionEntity r set r.inviterId = null where r.inviterId = :userId")
                .setParameter("userId", userId)
                .executeUpdate();
        return List.of();
    }

    /** 두 표의 외래 키는 계정 행과 함께 지워지거나({@code ON DELETE CASCADE}) 비워진다({@code SET NULL}). */
    @Override
    public boolean hasRecords(UUID userId) {
        return false;
    }
}
