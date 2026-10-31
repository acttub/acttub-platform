package com.acttub.actingapi.feature.challenge.adapter.sched;

import com.acttub.actingapi.feature.challenge.app.EntryViewDigestWorker;
import com.acttub.actingapi.platform.observability.FailureContext;
import com.acttub.actingapi.platform.observability.FailureReporter;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/** 하루 조회 요약 푸시를 매일 저녁 한 번 보낸다(SOMA-958). 테스트는 끄고 {@code runOnce} 를 직접 부른다. */
@Component
@ConditionalOnProperty(name = "CHALLENGE_VIEW_DIGEST_ENABLED", havingValue = "true", matchIfMissing = true)
class EntryViewDigestScheduler {
    private final EntryViewDigestWorker worker;
    private final FailureReporter failures;

    EntryViewDigestScheduler(EntryViewDigestWorker worker, FailureReporter failures) { this.worker = worker; this.failures = failures; }

    @Scheduled(cron = "${CHALLENGE_VIEW_DIGEST_CRON:0 0 20 * * *}", zone = "Asia/Seoul")
    void run() {
        try {
            worker.runOnce();
        } catch (RuntimeException failure) {
            failures.report(failure, new FailureContext("EntryViewDigestScheduler.run"));
        }
    }
}
