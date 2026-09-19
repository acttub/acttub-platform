package com.acttub.actingapi.feature.profile.adapter.sched;

import com.acttub.actingapi.feature.profile.app.AccountCleanup;
import com.acttub.actingapi.platform.observability.FailureContext;
import com.acttub.actingapi.platform.observability.FailureReporter;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * 탈퇴 뒤에 남은 정리를 정해진 간격으로 다시 시도한다. 일은 {@link AccountCleanup#runDue} 가 한다.
 *
 * <p>여러 프로세스가 함께 돌아도 된다 — 집는 문장이 같은 행을 둘에게 주지 않는다. 테스트는 이 빈을 끄고
 * 시계를 돌린 뒤 {@code runDue} 를 직접 부른다.
 */
@Component
@ConditionalOnProperty(name = "ACCOUNT_CLEANUP_ENABLED", havingValue = "true", matchIfMissing = true)
class AccountCleanupScheduler {
    private final AccountCleanup cleanup;
    private final FailureReporter failureReporter;

    AccountCleanupScheduler(AccountCleanup cleanup, FailureReporter failureReporter) {
        this.cleanup = cleanup;
        this.failureReporter = failureReporter;
    }

    @Scheduled(
            fixedDelayString = "${ACCOUNT_CLEANUP_INTERVAL_MS:300000}",
            initialDelayString = "${ACCOUNT_CLEANUP_INITIAL_DELAY_MS:60000}")
    void run() {
        try {
            cleanup.runDue();
        } catch (RuntimeException failure) {
            failureReporter.report(failure, new FailureContext("AccountCleanupScheduler.run"));
        }
    }
}
