package com.acttub.actingapi.feature.feedback.adapter.sched;

import com.acttub.actingapi.feature.feedback.app.ExitSurveySync;
import com.acttub.actingapi.platform.observability.FailureContext;
import com.acttub.actingapi.platform.observability.FailureReporter;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * 못 보낸 설문을 다시 보내고 90일 지난 연락처를 비운다 — 일은 {@link ExitSurveySync#runDaily} 가 한다
 * (practice.feedback).
 *
 * <p>계정 영역의 매일 도는 일과 스위치를 나눈다 — 설문 전송은 AI 작업도 계정 정리도 아니고, 시트가 죽어
 * 있는 동안 계정 정리까지 멈추면 안 된다. 테스트는 이 빈을 끄고 {@code runDaily} 를 직접 부른다.
 */
@Component
@ConditionalOnProperty(name = "EXIT_SURVEY_SYNC_ENABLED", havingValue = "true", matchIfMissing = true)
class ExitSurveySyncScheduler {

    private final ExitSurveySync sync;
    private final FailureReporter failureReporter;

    ExitSurveySyncScheduler(ExitSurveySync sync, FailureReporter failureReporter) {
        this.sync = sync;
        this.failureReporter = failureReporter;
    }

    @Scheduled(
            fixedDelayString = "${EXIT_SURVEY_SYNC_INTERVAL_MS:86400000}",
            initialDelayString = "${EXIT_SURVEY_SYNC_INITIAL_DELAY_MS:120000}")
    void run() {
        try {
            sync.runDaily();
        } catch (RuntimeException failure) {
            failureReporter.report(failure, new FailureContext("ExitSurveySyncScheduler.run"));
        }
    }
}
