package com.acttub.actingapi.feature.memory.adapter.db;

import java.util.List;
import java.util.Set;
import java.util.UUID;

import com.acttub.actingapi.feature.auth.app.AccountErasure;
import com.acttub.actingapi.feature.auth.app.AccountErasureStep;
import com.acttub.actingapi.feature.auth.app.ClosingAccount;
import jakarta.persistence.EntityManager;
import org.springframework.stereotype.Repository;

/**
 * 계정을 닫을 때 배우 기억에서 하는 일 (account.withdraw, account.profile).
 *
 * <p>탈퇴는 배우 기억을 사람과 끊어 남긴다 — 맡는 자리가 없다. 여기는 이 계정의 기억이 있는지만 답한다. 있으면 만 14세 미만
 * 계정도 행째 지우지 않고 탈퇴와 같은 절차로 닫는다.
 */
@Repository
class PostgresMemoryAccountErasure implements AccountErasure {

    /**
     * 이 계정을 가리키는 배우 기억. 0.1.0 이전 기억({@code actor_memory_entries})은 외래 키가 계정 행을 지우지 못하게 막지는
     * 않지만 남기는 자료라 함께 센다.
     */
    private static final List<String> RECORDS = List.of(
            "select m.id from ActorMemoryEntity m where m.userId = :userId",
            "select m.id from ActorMemoryEntryEntity m where m.userId = :userId");

    private final EntityManager entityManager;

    PostgresMemoryAccountErasure(EntityManager entityManager) {
        this.entityManager = entityManager;
    }

    @Override
    public Set<AccountErasureStep> steps() {
        return Set.of();
    }

    @Override
    public List<UUID> erase(AccountErasureStep step, ClosingAccount account) {
        throw new IllegalArgumentException("not a memory step: " + step);
    }

    @Override
    public boolean hasRecords(UUID userId) {
        return RECORDS.stream().anyMatch(query -> !entityManager.createQuery(query, UUID.class)
                .setParameter("userId", userId)
                .setMaxResults(1)
                .getResultList()
                .isEmpty());
    }
}
