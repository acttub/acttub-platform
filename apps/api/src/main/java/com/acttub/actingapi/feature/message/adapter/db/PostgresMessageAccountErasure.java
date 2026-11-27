package com.acttub.actingapi.feature.message.adapter.db;

import java.util.List;
import java.util.Set;
import java.util.UUID;

import com.acttub.actingapi.feature.auth.app.AccountErasure;
import com.acttub.actingapi.feature.auth.app.AccountErasureStep;
import com.acttub.actingapi.feature.auth.app.ClosingAccount;
import jakarta.persistence.EntityManager;
import org.springframework.stereotype.Repository;

/**
 * 계정을 닫을 때 1:1 메시지에서 하는 일 (account.withdraw, SOMA-1039).
 *
 * <p>탈퇴에서 고칠 것이 없다. 대화와 메시지 행은 상대의 대화방을 깨지 않게 남고, 상대 화면에는 "탈퇴한 사용자"로 보인다
 * (이름은 행에 복사하지 않고 profile 에서 읽으므로 탈퇴하면 그 표시로 바뀐다). 탈퇴한 상대에게는 보낼 수 없다.
 *
 * <p>행이 계정 행을 외래 키로 가리키므로(ON DELETE 없음) 자료로 센다 — 메시지를 주고받은 계정은 행째 지우지 않고 탈퇴
 * 절차로 닫는다.
 */
@Repository
class PostgresMessageAccountErasure implements AccountErasure {

    private static final List<String> RECORDS = List.of(
            "select c.id from DirectConversationEntity c where c.starterUserId = :userId",
            "select c.id from DirectConversationEntity c where c.recipientUserId = :userId",
            "select m.id from DirectMessageEntity m where m.senderUserId = :userId");

    private final EntityManager entityManager;

    PostgresMessageAccountErasure(EntityManager entityManager) {
        this.entityManager = entityManager;
    }

    @Override
    public Set<AccountErasureStep> steps() {
        return Set.of();
    }

    @Override
    public List<UUID> erase(AccountErasureStep step, ClosingAccount account) {
        return List.of();
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
