package com.acttub.actingapi.feature.practice.adapter.db;

import java.time.Instant;
import java.time.ZoneOffset;
import java.util.UUID;

import com.acttub.actingapi.feature.auth.app.AccountRowLock;
import com.acttub.actingapi.feature.practice.app.CoachingRewardRepository;
import jakarta.persistence.EntityManager;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 보상형 광고로 받은 코칭 1회의 장부(SOMA-1067, V103 {@code coaching_rewards}). 세기·확인은 HQL 이고, 넣기만
 * {@code ON CONFLICT DO NOTHING} 이라 native 로 둔다(CONTRACT §5-2).
 *
 * <p>지급은 <b>계정 행</b>을 잡고 한다({@link AccountRowLock}) — 회차 시작의 한도 세기({@link PostgresPracticeRepository})가 같은
 * 행을 잡으므로 지급과 시작이 겹쳐도 순서가 정해지고, 같은 사람에게 서로 다른 시청이 겹쳐 와도 하루 상한을 넘지 않는다. 탈퇴가
 * 먼저 잡았으면 활성이 아님을 보고 지급하지 않는다.
 */
@Repository
class PostgresCoachingRewardRepository implements CoachingRewardRepository {
    private final EntityManager entityManager;
    private final TransactionTemplate transaction;
    private final AccountRowLock accountRows;

    PostgresCoachingRewardRepository(EntityManager entityManager, PlatformTransactionManager transactionManager,
                                     AccountRowLock accountRows) {
        this.entityManager = entityManager;
        this.transaction = new TransactionTemplate(transactionManager);
        this.accountRows = accountRows;
    }

    @Override
    public int grantedSince(UUID userId, Instant since) {
        return entityManager.createQuery(
                        "select count(r) from CoachingRewardEntity r where r.userId = :userId and r.createdAt >= :since",
                        Long.class)
                .setParameter("userId", userId)
                .setParameter("since", since)
                .getSingleResult()
                .intValue();
    }

    @Override
    public int sessionsSince(UUID userId, Instant since) {
        Number counted = (Number) entityManager.createNativeQuery(PostgresPracticeRepository.FREE_COACHING_SESSIONS_SINCE)
                .setParameter("userId", userId)
                .setParameter("since", since.atOffset(ZoneOffset.UTC))
                .getSingleResult();
        return counted.intValue();
    }

    @Override
    public Grant grant(NewReward reward, Instant since, int dailyLimit, Instant now) {
        return transaction.execute(tx -> {
            if (!accountRows.lockActive(reward.userId())) {
                return Grant.NO_USER;
            }
            boolean seen = !entityManager.createQuery("""
                            select r.transactionId from CoachingRewardEntity r
                            where r.transactionId = :transactionId or (r.userId = :userId and r.requestId = :requestId)
                            """, String.class)
                    .setParameter("transactionId", reward.transactionId())
                    .setParameter("userId", reward.userId())
                    .setParameter("requestId", reward.requestId())
                    .setMaxResults(1)
                    .getResultList()
                    .isEmpty();
            if (seen) {
                return Grant.DUPLICATE;
            }
            if (grantedSince(reward.userId(), since) >= dailyLimit) {
                return Grant.CAPPED;
            }
            int inserted = entityManager.createNativeQuery("""
                    INSERT INTO coaching_rewards(transaction_id,user_id,request_id,created_at)
                    VALUES (:transactionId,:userId,:requestId,:now)
                    ON CONFLICT DO NOTHING
                    """)
                    .setParameter("transactionId", reward.transactionId())
                    .setParameter("userId", reward.userId())
                    .setParameter("requestId", reward.requestId())
                    .setParameter("now", now.atOffset(ZoneOffset.UTC))
                    .executeUpdate();
            return inserted == 1 ? Grant.GRANTED : Grant.DUPLICATE;
        });
    }

    @Override
    public boolean granted(UUID userId, UUID requestId) {
        return !entityManager.createQuery(
                        "select r.transactionId from CoachingRewardEntity r where r.userId = :userId and r.requestId = :requestId",
                        String.class)
                .setParameter("userId", userId)
                .setParameter("requestId", requestId)
                .setMaxResults(1)
                .getResultList()
                .isEmpty();
    }
}
