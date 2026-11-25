package com.acttub.actingapi.feature.portfolio.adapter.db;

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
 * 계정을 닫을 때 포트폴리오를 행째 지운다 (account.withdraw, account.portfolio).
 *
 * <p>경력·사진 행은 {@code ON DELETE CASCADE} 로 따라 지워진다. 공유 링크는 이 순간부터 404 다. 사진 객체의 키는 이 자리보다
 * 앞선 {@link AccountErasureStep#MEDIA_OBJECTS} 자리가 읽어 장부에 올린다.
 *
 * <p>트랜잭션을 열지 않는다 — 계정을 닫는 트랜잭션에 참여한다.
 */
@Repository
class PostgresPortfolioAccountErasure implements AccountErasure {

    private final EntityManager entityManager;

    PostgresPortfolioAccountErasure(EntityManager entityManager) {
        this.entityManager = entityManager;
    }

    @Override
    public Set<AccountErasureStep> steps() {
        return EnumSet.of(AccountErasureStep.PORTFOLIO);
    }

    @Override
    public List<UUID> erase(AccountErasureStep step, ClosingAccount account) {
        entityManager.createQuery("delete from PortfolioEntity p where p.userId = :userId")
                .setParameter("userId", account.userId())
                .executeUpdate();
        return List.of();
    }

    /** 포트폴리오는 계정 행과 함께 지워진다({@code ON DELETE CASCADE}). */
    @Override
    public boolean hasRecords(UUID userId) {
        return false;
    }
}
