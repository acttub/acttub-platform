package com.acttub.actingapi.feature.reading.adapter.sched;

import com.acttub.actingapi.feature.reading.app.PronunciationWorker;
import com.acttub.actingapi.platform.observability.FailureContext;
import com.acttub.actingapi.platform.observability.FailureReporter;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/** 발음 보고서 큐를 돈다(SOMA-606). {@code PRON_REPORT_ENABLED=true} 일 때만 뜬다 — 운영은 기본 꺼짐. 한 번에 하나씩 처리한다. */
@Component
@ConditionalOnProperty(name = "PRON_REPORT_ENABLED", havingValue = "true")
class PronunciationWorkerScheduler {
    private final PronunciationWorker worker;
    private final FailureReporter failures;

    PronunciationWorkerScheduler(PronunciationWorker worker, FailureReporter failures) {
        this.worker = worker;
        this.failures = failures;
    }

    @Scheduled(fixedDelayString = "${PRON_REPORT_POLL_MS:5000}")
    void run() {
        try {
            while (worker.runOnce()) {
                // 쌓인 것을 다 비운다. 집을 것이 없으면 다음 주기를 기다린다.
            }
        } catch (RuntimeException failure) {
            failures.report(failure, new FailureContext("PronunciationWorkerScheduler.run"));
        }
    }
}
