package com.acttub.actingapi.feature.reading.adapter.sched;

import com.acttub.actingapi.feature.reading.app.PronunciationWorker;
import com.acttub.actingapi.platform.observability.FailureReporter;
import com.acttub.actingapi.platform.observability.SingleThreadDrain;
import jakarta.annotation.PreDestroy;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * 발음 보고서 큐를 돈다(SOMA-606). {@code PRON_REPORT_ENABLED=true} 일 때만 뜬다 — 운영은 기본 꺼짐. 한 번에 하나씩 처리한다.
 * 비우기는 자기 스레드({@code pron-report-worker})에서 한다({@link SingleThreadDrain}).
 */
@Component
@ConditionalOnProperty(name = "PRON_REPORT_ENABLED", havingValue = "true")
class PronunciationWorkerScheduler {
    private final SingleThreadDrain thread;

    PronunciationWorkerScheduler(PronunciationWorker worker, FailureReporter failures) {
        this.thread = new SingleThreadDrain(PronunciationWorkerScheduler.class, "pron-report-worker", failures, worker::runOnce);
    }

    @Scheduled(fixedDelayString = "${PRON_REPORT_POLL_MS:5000}")
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
