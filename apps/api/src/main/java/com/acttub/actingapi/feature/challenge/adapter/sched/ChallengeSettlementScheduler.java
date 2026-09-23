package com.acttub.actingapi.feature.challenge.adapter.sched;

import java.time.Clock;
import com.acttub.actingapi.feature.challenge.app.EntryRepository;
import com.acttub.actingapi.platform.observability.FailureContext;
import com.acttub.actingapi.platform.observability.FailureReporter;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * 매시 도는 일 — 마감이 지났는데 아무 변경도 닿지 않은 챌린지를 집계하고, 검토가 끝난 챌린지의 순위를 확정하고,
 * 7일 지난 조회수 사건과 오래된 좋아요순 커서를 지운다 (challenge.browse). 테스트는 이 빈을 끄고
 * {@link EntryRepository#settle} 을 직접 부른다.
 */
@Component
@ConditionalOnProperty(name = "CHALLENGE_SETTLEMENT_ENABLED", havingValue = "true", matchIfMissing = true)
class ChallengeSettlementScheduler {
    private final EntryRepository entries;
    private final Clock clock;
    private final FailureReporter failureReporter;

    ChallengeSettlementScheduler(EntryRepository entries, Clock clock, FailureReporter failureReporter) {
        this.entries = entries; this.clock = clock; this.failureReporter = failureReporter;
    }

    @Scheduled(fixedDelayString = "${CHALLENGE_SETTLEMENT_INTERVAL_MS:3600000}",
            initialDelayString = "${CHALLENGE_SETTLEMENT_INITIAL_DELAY_MS:180000}")
    void run() {
        try {
            entries.settle(clock.instant());
        } catch (RuntimeException failure) {
            failureReporter.report(failure, new FailureContext("ChallengeSettlementScheduler.run"));
        }
    }
}
