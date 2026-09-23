package com.acttub.actingapi.feature.challenge.adapter.sched;

import com.acttub.actingapi.feature.challenge.app.ChallengeReportWorker;
import com.acttub.actingapi.platform.observability.FailureContext;
import com.acttub.actingapi.platform.observability.FailureReporter;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * 챌린지 AI 리포트 큐를 비운다 (challenge.ai-report). 스위치를 분석·기억 워커와 공유한다 — 셋 다 {@code ai_jobs} 를
 * 소비하므로 "이 프로세스가 AI 큐의 주인인가"가 한 질문이다. 테스트는 스위치를 끄고 {@code runOnce} 를 직접 부른다.
 */
@Component
@ConditionalOnProperty(name = "ANALYSIS_WORKER_ENABLED", havingValue = "true", matchIfMissing = true)
class ChallengeReportScheduler {
    private final ChallengeReportWorker worker;
    private final FailureReporter failures;

    ChallengeReportScheduler(ChallengeReportWorker worker, FailureReporter failures) { this.worker = worker; this.failures = failures; }

    @Scheduled(fixedDelayString = "${CHALLENGE_REPORT_POLL_INTERVAL_MS:5000}", initialDelayString = "${CHALLENGE_REPORT_INITIAL_DELAY_MS:15000}")
    void poll() {
        try {
            while (worker.runOnce()) {
                // 일감이 있는 동안은 기다리지 않는다.
            }
        } catch (RuntimeException failure) {
            failures.report(failure, new FailureContext("ChallengeReportScheduler.poll"));
        }
    }
}
