package com.acttub.actingapi.feature.reading.adapter.sched;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Semaphore;

import com.acttub.actingapi.feature.reading.app.ScriptSplitWorker;
import com.acttub.actingapi.platform.observability.FailureContext;
import com.acttub.actingapi.platform.observability.FailureReporter;
import jakarta.annotation.PreDestroy;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * 대본 나누기 큐를 비운다 (reading.script 「나누기 작업」). 영상 분석·기억·챌린지 리포트와 섞이지 않는 자기 스케줄러다 — 사용자가
 * 팝업에서 기다리므로 1초마다 본다. 유휴에는 선점 질의 하나만 나가고, 작업을 집으면 그때 다음 일꾼을 하나 더 띄워 동시 수(기본 4)
 * 까지 늘린다. 스위치는 분석 워커와 공유한다 — 넷 다 {@code ai_jobs} 를 소비하므로 "이 프로세스가 AI 큐의 주인인가"가 한 질문이다.
 * 테스트는 스위치를 끄고 {@code runOnce} 를 직접 부른다.
 */
@Component
@ConditionalOnProperty(name = "ANALYSIS_WORKER_ENABLED", havingValue = "true", matchIfMissing = true)
class ScriptSplitScheduler {
    private final ScriptSplitWorker worker;
    private final FailureReporter failures;
    private final Semaphore slots;
    private final ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor();

    ScriptSplitScheduler(ScriptSplitWorker worker, FailureReporter failures,
            @Value("${SCRIPT_SPLIT_CONCURRENCY:4}") int concurrency) {
        this.worker = worker;
        this.failures = failures;
        this.slots = new Semaphore(concurrency);
    }

    @Scheduled(fixedDelayString = "${SCRIPT_SPLIT_POLL_INTERVAL_MS:1000}", initialDelayString = "${SCRIPT_SPLIT_INITIAL_DELAY_MS:15000}")
    void poll() {
        try {
            worker.sweep();
        } catch (RuntimeException failure) {
            failures.report(failure, new FailureContext("ScriptSplitScheduler.sweep"));
        }
        spawn();
    }

    /** 자리가 있으면 일꾼 하나. 일꾼은 작업을 집을 때마다 다음 일꾼을 부르고, 집을 게 없으면 자리를 내놓는다. */
    private void spawn() {
        if (!slots.tryAcquire()) {
            return;
        }
        executor.execute(() -> {
            try {
                while (worker.runOnce()) {
                    spawn();
                }
            } catch (RuntimeException failure) {
                failures.report(failure, new FailureContext("ScriptSplitScheduler.poll"));
            } finally {
                slots.release();
            }
        });
    }

    @PreDestroy
    void shutdown() {
        executor.shutdownNow();
    }
}
