package com.acttub.actingapi.feature.reading.adapter.sched;

import com.acttub.actingapi.feature.reading.app.RetranscribeWorker;
import com.acttub.actingapi.platform.observability.FailureContext;
import com.acttub.actingapi.platform.observability.FailureReporter;
import jakarta.annotation.PreDestroy;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * 리딩 녹음 서버 다시 받아쓰기 큐를 돈다. {@code READING_RETRANSCRIBE_ENABLED=true} 일 때만 뜬다. 한 번에 하나씩 처리한다.
 *
 * <p>큐 비우기는 자기 스레드({@code retranscribe-worker}) 하나에서 한다. 공용 스케줄러에서 직접 비우면 일이 쌓였을 때 그동안 다른 예약 작업
 * (대본 나누기 등)이 차례를 받지 못한다 — 2026-11-04 쌓인 다시 받아쓰기 640건이 공용 스레드를 347초 붙잡아 대본 나누기가
 * 10~20분 밀렸다. 폴은 비우기가 돌고 있으면 바로 돌아오고, 돌고 있지 않을 때만 하나를 띄운다.
 */
@Component
@ConditionalOnProperty(name = "READING_RETRANSCRIBE_ENABLED", havingValue = "true")
class RetranscribeWorkerScheduler {
    private final RetranscribeWorker worker;
    private final FailureReporter failures;
    private final AtomicBoolean draining = new AtomicBoolean();
    private final ExecutorService executor = Executors.newSingleThreadExecutor(
            Thread.ofPlatform().name("retranscribe-worker").daemon(true).factory());

    RetranscribeWorkerScheduler(RetranscribeWorker worker, FailureReporter failures) {
        this.worker = worker;
        this.failures = failures;
    }

    @Scheduled(fixedDelayString = "${READING_RETRANSCRIBE_POLL_MS:10000}")
    void poll() {
        if (!draining.compareAndSet(false, true)) {
            return;
        }
        try {
            executor.execute(() -> {
                try {
                    drain();
                } finally {
                    draining.set(false);
                }
            });
        } catch (RuntimeException rejected) {
            draining.set(false);
            failures.report(rejected, new FailureContext("RetranscribeWorkerScheduler.poll"));
        }
    }

    /** 집을 것이 없을 때까지 하나씩 처리한다. 실패는 알리고 다음 폴을 기다린다. */
    void drain() {
        try {
            while (worker.runOnce()) {
                // 쌓인 것을 다 비운다. 집을 것이 없거나 한도·실패로 멈추면 다음 주기를 기다린다.
            }
        } catch (RuntimeException failure) {
            failures.report(failure, new FailureContext("RetranscribeWorkerScheduler.drain"));
        }
    }

    @PreDestroy
    void shutdown() {
        executor.shutdownNow();
    }
}
