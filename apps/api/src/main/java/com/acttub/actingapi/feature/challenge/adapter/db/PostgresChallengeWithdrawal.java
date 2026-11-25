package com.acttub.actingapi.feature.challenge.adapter.db;

import java.time.Instant;
import java.util.UUID;
import com.acttub.actingapi.feature.challenge.app.ChallengeWithdrawal;
import org.springframework.stereotype.Component;

@Component
class PostgresChallengeWithdrawal implements ChallengeWithdrawal {
    private final ChallengeJpaRepository challenges;
    private final ChallengeSettlement settlement;
    PostgresChallengeWithdrawal(ChallengeJpaRepository challenges, ChallengeSettlement settlement) {
        this.challenges = challenges; this.settlement = settlement;
    }

    @Override
    public void settleBeforeWithdrawal(UUID userId, Instant now) {
        challenges.dueWithEntryOf(userId, now).forEach(id -> settlement.settle(id, now));
    }
}
