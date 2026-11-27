package com.acttub.actingapi.feature.challenge.adapter.db;

import java.time.Instant;
import java.util.UUID;
import com.acttub.actingapi.feature.auth.app.PendingSettlement;
import org.springframework.stereotype.Component;

/**
 * 계정을 닫는 트랜잭션(account.withdraw)이 상태를 바꾸기 직전에 부른다. 탈퇴도 "마감 뒤 첫 변경"이므로, 이 사람의 참여작이 있는
 * 챌린지 가운데 마감이 지났는데 아직 집계되지 않은 것을 먼저 집계한다 — 그래야 마감 당시 자격이 있던 참여작이 탈퇴의 비공개
 * 전환 때문에 최종 순위에서 빠지지 않는다. 부르는 쪽의 트랜잭션에 참여한다.
 */
@Component
class PostgresChallengeWithdrawal implements PendingSettlement {
    private final ChallengeJpaRepository challenges;
    private final ChallengeSettlement settlement;
    PostgresChallengeWithdrawal(ChallengeJpaRepository challenges, ChallengeSettlement settlement) {
        this.challenges = challenges; this.settlement = settlement;
    }

    @Override
    public void settleBeforeDeactivation(UUID userId, Instant now) {
        challenges.dueWithEntryOf(userId, now).forEach(id -> settlement.settle(id, now));
    }
}
