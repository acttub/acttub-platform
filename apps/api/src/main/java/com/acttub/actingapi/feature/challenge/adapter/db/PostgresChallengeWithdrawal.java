package com.acttub.actingapi.feature.challenge.adapter.db;

import java.time.Instant;
import java.time.ZoneOffset;
import java.util.UUID;
import com.acttub.actingapi.feature.challenge.app.ChallengeWithdrawal;
import com.acttub.actingapi.platform.persistence.NativeTuples;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Tuple;
import org.springframework.stereotype.Component;

@Component
class PostgresChallengeWithdrawal implements ChallengeWithdrawal {
    private final EntityManager em;
    private final ChallengeSettlement settlement;
    PostgresChallengeWithdrawal(EntityManager em, ChallengeSettlement settlement) { this.em = em; this.settlement = settlement; }

    @Override
    public void settleBeforeWithdrawal(UUID userId, Instant now) {
        NativeTuples.list(em.createNativeQuery("""
                SELECT DISTINCT c.id FROM challenges c JOIN challenge_entries e ON e.challenge_id=c.id
                WHERE e.user_id=:user AND e.status<>'deleted' AND c.ranking_state IS NULL AND c.ends_at<=:now
                ORDER BY c.id
                """, Tuple.class).setParameter("user", userId).setParameter("now", now.atOffset(ZoneOffset.UTC)))
                .forEach(row -> settlement.settle(row.get("id", UUID.class), now));
    }
}
