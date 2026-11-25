package com.acttub.actingapi.feature.challenge.adapter.sched;

import com.acttub.actingapi.feature.challenge.app.ChallengeReportWorker;
import com.acttub.actingapi.platform.observability.FailureReporter;
import com.acttub.actingapi.platform.observability.SingleThreadDrain;
import jakarta.annotation.PreDestroy;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * 챌린지 AI 리포트 큐를 비운다 (challenge.ai-report). 스위치를 분석·기억 워커와 공유한다 — 셋 다 {@code ai_jobs} 를
 * 소비하므로 "이 프로세스가 AI 큐의 주인인가"가 한 질문이다. 테스트는 스위치를 끄고 {@code runOnce} 를 직접 부른다.
 *
 * <p>비우기는 자기 스레드({@code challenge-report-worker})에서 하고({@link SingleThreadDrain}), 비우기마다 죽은 워커가 남긴
 * 리포트를 먼저 닫는다.
 */
@Component
@ConditionalOnProperty(name = "ANALYSIS_WORKER_ENABLED", havingValue = "true", matchIfMissing = true)
class ChallengeReportScheduler {
    private final SingleThreadDrain thread;

    ChallengeReportScheduler(ChallengeReportWorker worker, FailureReporter failures) {
        this.thread = new SingleThreadDrain(
                ChallengeReportScheduler.class, "challenge-report-worker", failures, worker::closeAbandoned, worker::runOnce);
    }

    @Scheduled(fixedDelayString = "${CHALLENGE_REPORT_POLL_INTERVAL_MS:5000}", initialDelayString = "${CHALLENGE_REPORT_INITIAL_DELAY_MS:15000}")
    void poll() {
        thread.poll();
    }

    /** 폴을 거치지 않고 부른 스레드에서 한 번 비운다. */
    void drain() {
        thread.drain();
    }

    @PreDestroy
    void shutdown() {
        thread.shutdown();
    }
}
