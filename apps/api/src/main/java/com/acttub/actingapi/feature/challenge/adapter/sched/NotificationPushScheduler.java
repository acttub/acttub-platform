package com.acttub.actingapi.feature.challenge.adapter.sched;

import com.acttub.actingapi.feature.challenge.app.NotificationPushWorker;
import com.acttub.actingapi.platform.observability.FailureContext;
import com.acttub.actingapi.platform.observability.FailureReporter;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/** 때가 된 챌린지 알림 묶음을 1분마다 보낸다 (challenge.notification). 테스트는 끄고 {@code runOnce} 를 직접 부른다. */
@Component
@ConditionalOnProperty(name = "CHALLENGE_NOTIFICATION_PUSH_ENABLED", havingValue = "true", matchIfMissing = true)
class NotificationPushScheduler {
    private final NotificationPushWorker worker;
    private final FailureReporter failures;

    NotificationPushScheduler(NotificationPushWorker worker, FailureReporter failures) { this.worker = worker; this.failures = failures; }

    @Scheduled(fixedDelayString = "${CHALLENGE_NOTIFICATION_PUSH_INTERVAL_MS:60000}",
            initialDelayString = "${CHALLENGE_NOTIFICATION_PUSH_INITIAL_DELAY_MS:30000}")
    void run() {
        try {
            while (worker.runOnce() > 0) {
                // 밀린 묶음이 있으면 이어서 보낸다.
            }
        } catch (RuntimeException failure) {
            failures.report(failure, new FailureContext("NotificationPushScheduler.run"));
        }
    }
}
