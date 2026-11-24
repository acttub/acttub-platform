package com.acttub.actingapi.feature.practice.adapter.db;

import java.time.Instant;
import java.time.ZoneOffset;
import java.util.UUID;

import com.acttub.actingapi.feature.practice.app.CoachingRewardRepository;
import com.acttub.actingapi.platform.persistence.NativeTuples;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Tuple;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 보상형 광고로 받은 코칭 1회의 장부(SOMA-1067, V95 {@code coaching_rewards}). native SQL 만 쓴다(Schema Entity 없음).
 *
 * <p>지급은 <b>사용자 행</b>을 잡고 한다 — 회차 시작의 한도 세기({@link PostgresPracticeRepository})가 같은 행을 잡으므로
 * 지급과 시작이 겹쳐도 순서가 정해지고, 같은 사람에게 서로 다른 시청이 겹쳐 와도 하루 상한을 넘지 않는다.
 */
@Repository
class PostgresCoachingRewardRepository implements CoachingRewardRepository {
    private final EntityManager entityManager;
    private final TransactionTemplate transaction;

    PostgresCoachingRewardRepository(EntityManager entityManager, PlatformTransactionManager transactionManager) {
        this.entityManager = entityManager;
        this.transaction = new TransactionTemplate(transactionManager);
    }

    @Override
    public int grantedSince(UUID userId, Instant since) {
        return count("SELECT count(*) FROM coaching_rewards WHERE user_id=:userId AND created_at>=:since", userId, since);
    }

    @Override
    public int sessionsSince(UUID userId, Instant since) {
        return count(PostgresPracticeRepository.FREE_COACHING_SESSIONS_SINCE, userId, since);
    }

    @Override
    public Grant grant(NewReward reward, Instant since, int dailyLimit, Instant now) {
        return transaction.execute(tx -> {
            boolean userExists = !NativeTuples.list(entityManager.createNativeQuery(
                    "SELECT id FROM users WHERE id=:userId FOR UPDATE", Tuple.class)
                    .setParameter("userId", reward.userId())).isEmpty();
            if (!userExists) {
                return Grant.NO_USER;
            }
            boolean seen = !NativeTuples.list(entityManager.createNativeQuery("""
                    SELECT transaction_id FROM coaching_rewards
                    WHERE transaction_id=:transactionId OR (user_id=:userId AND request_id=:requestId)
                    """, Tuple.class)
                    .setParameter("transactionId", reward.transactionId())
                    .setParameter("userId", reward.userId())
                    .setParameter("requestId", reward.requestId())).isEmpty();
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
        return !NativeTuples.list(entityManager.createNativeQuery(
                "SELECT transaction_id FROM coaching_rewards WHERE user_id=:userId AND request_id=:requestId", Tuple.class)
                .setParameter("userId", userId)
                .setParameter("requestId", requestId)).isEmpty();
    }

    private int count(String sql, UUID userId, Instant since) {
        Number counted = (Number) entityManager.createNativeQuery(sql)
                .setParameter("userId", userId)
                .setParameter("since", since.atOffset(ZoneOffset.UTC))
                .getSingleResult();
        return counted.intValue();
    }
}
