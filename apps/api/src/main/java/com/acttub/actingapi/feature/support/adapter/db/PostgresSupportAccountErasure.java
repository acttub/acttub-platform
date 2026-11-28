package com.acttub.actingapi.feature.support.adapter.db;

import java.util.List;
import java.util.Set;
import java.util.UUID;

import com.acttub.actingapi.feature.auth.app.AccountErasure;
import com.acttub.actingapi.feature.auth.app.AccountErasureStep;
import com.acttub.actingapi.feature.auth.app.ClosingAccount;
import jakarta.persistence.EntityManager;
import org.springframework.stereotype.Repository;

/**
 * 계정을 닫을 때 문의에서 하는 일 (app.support-inquiry, account.profile).
 *
 * <p>탈퇴는 문의를 그대로 남긴다 — 맡는 자리가 없다. 만 14세 미만 계정 닫기가 계정 행을 지울 때만 그 계정으로 접수된 문의를
 * 지운다. {@code user_id} 에 외래 키가 없어 계정 행과 함께 지워지지 않는다. 토큰 없이 접수된 문의는 계정과 이을 수 없어 남는다.
 *
 * <p>트랜잭션을 열지 않는다 — 계정을 닫는 트랜잭션에 참여한다.
 */
@Repository
class PostgresSupportAccountErasure implements AccountErasure {

    private final EntityManager entityManager;

    PostgresSupportAccountErasure(EntityManager entityManager) {
        this.entityManager = entityManager;
    }

    @Override
    public Set<AccountErasureStep> steps() {
        return Set.of();
    }

    @Override
    public List<UUID> erase(AccountErasureStep step, ClosingAccount account) {
        throw new IllegalArgumentException("not a support step: " + step);
    }

    @Override
    public void eraseWithAccountRow(UUID userId) {
        entityManager.createQuery("delete from SupportInquiryEntity i where i.userId = :userId")
                .setParameter("userId", userId)
                .executeUpdate();
    }
}
