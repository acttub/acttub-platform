package com.acttub.actingapi.feature.reading.adapter.sched;

import com.acttub.actingapi.feature.reading.app.RetranscribeWorker;
import com.acttub.actingapi.platform.observability.FailureReporter;
import com.acttub.actingapi.platform.observability.SingleThreadDrain;
import jakarta.annotation.PreDestroy;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * 리딩 녹음 서버 다시 받아쓰기 큐를 돈다. {@code READING_RETRANSCRIBE_ENABLED=true} 일 때만 뜬다. 한 번에 하나씩 처리한다.
 * 비우기는 자기 스레드({@code retranscribe-worker})에서 한다({@link SingleThreadDrain}).
 */
@Component
@ConditionalOnProperty(name = "READING_RETRANSCRIBE_ENABLED", havingValue = "true")
class RetranscribeWorkerScheduler {
    private final SingleThreadDrain thread;

    RetranscribeWorkerScheduler(RetranscribeWorker worker, FailureReporter failures) {
        this.thread = new SingleThreadDrain(RetranscribeWorkerScheduler.class, "retranscribe-worker", failures, worker::runOnce);
    }

    @Scheduled(fixedDelayString = "${READING_RETRANSCRIBE_POLL_MS:10000}")
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
