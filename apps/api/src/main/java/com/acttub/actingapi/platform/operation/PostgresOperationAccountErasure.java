package com.acttub.actingapi.platform.operation;

import java.util.EnumSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import com.acttub.actingapi.feature.auth.app.AccountErasure;
import com.acttub.actingapi.feature.auth.app.AccountErasureStep;
import com.acttub.actingapi.feature.auth.app.ClosingAccount;
import com.acttub.actingapi.platform.schema.OperationStatus;
import jakarta.persistence.EntityManager;
import org.springframework.stereotype.Repository;

/**
 * 계정을 닫을 때 진행 중인 작업을 실패로 닫는다 (account.withdraw, apps/api/CONTRACT.md §5-7).
 *
 * <p>lease 를 떼므로 돌고 있던 워커의 완료는 lease 가 맞지 않아 통째로 롤백되고 결과가 저장되지 않는다. 이력은 남긴다.
 * AI 작업({@code ai_jobs})은 결과 본문도 비운다. 옛 연습 흐름의 작업({@code external_operations})은 감시 lease 도 뗀다.
 *
 * <p>트랜잭션을 열지 않는다 — 계정을 닫는 트랜잭션에 참여한다.
 */
@Repository
class PostgresOperationAccountErasure implements AccountErasure {

    private final EntityManager entityManager;
    private final PostgresAiJobLedger jobs;

    PostgresOperationAccountErasure(EntityManager entityManager, PostgresAiJobLedger jobs) {
        this.jobs = jobs;
        this.entityManager = entityManager;
    }

    @Override
    public Set<AccountErasureStep> steps() {
        return EnumSet.of(AccountErasureStep.AI_JOBS, AccountErasureStep.LEGACY_OPERATIONS);
    }

    @Override
    public List<UUID> erase(AccountErasureStep step, ClosingAccount account) {
        switch (step) {
            case AI_JOBS -> cancelAiJobs(account);
            case LEGACY_OPERATIONS -> cancelLegacyOperations(account);
            default -> throw new IllegalArgumentException("not an operation step: " + step);
        }
        return List.of();
    }

    private void cancelAiJobs(ClosingAccount account) {
        jobs.failAllOfClosedAccount(account.userId(), account.now());
    }

    private void cancelLegacyOperations(ClosingAccount account) {
        entityManager.createQuery("""
                        update ExternalOperationEntity o
                        set o.status = :failed, o.errorCode = 'account_deactivated',
                            o.leaseToken = null, o.leaseExpiresAt = null, o.monitoringLeaseToken = null,
                            o.updatedAt = :now
                        where o.userId = :userId and o.status in (:pending, :running)
                        """)
                .setParameter("failed", OperationStatus.FAILED)
                .setParameter("pending", OperationStatus.PENDING)
                .setParameter("running", OperationStatus.RUNNING)
                .setParameter("now", account.now())
                .setParameter("userId", account.userId())
                .executeUpdate();
    }
}
