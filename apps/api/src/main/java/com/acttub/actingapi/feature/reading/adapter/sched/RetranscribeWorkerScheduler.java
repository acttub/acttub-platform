package com.acttub.actingapi.feature.reading.adapter.sched;

import com.acttub.actingapi.feature.reading.app.RetranscribeWorker;
import com.acttub.actingapi.platform.observability.FailureContext;
import com.acttub.actingapi.platform.observability.FailureReporter;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/** 리딩 녹음 서버 다시 받아쓰기 큐를 돈다. {@code READING_RETRANSCRIBE_ENABLED=true} 일 때만 뜬다. 한 번에 하나씩 처리한다. */
@Component
@ConditionalOnProperty(name = "READING_RETRANSCRIBE_ENABLED", havingValue = "true")
class RetranscribeWorkerScheduler {
    private final RetranscribeWorker worker;
    private final FailureReporter failures;

    RetranscribeWorkerScheduler(RetranscribeWorker worker, FailureReporter failures) {
        this.worker = worker;
        this.failures = failures;
    }

    @Scheduled(fixedDelayString = "${READING_RETRANSCRIBE_POLL_MS:10000}")
    void run() {
        try {
            while (worker.runOnce()) {
                // 쌓인 것을 다 비운다. 집을 것이 없거나 한도·실패로 멈추면 다음 주기를 기다린다.
            }
        } catch (RuntimeException failure) {
            failures.report(failure, new FailureContext("RetranscribeWorkerScheduler.run"));
        }
    }
}
