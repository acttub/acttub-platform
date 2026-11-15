package com.acttub.actingapi.feature.reading.adapter.sched;

import java.time.Duration;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;

import com.acttub.actingapi.feature.reading.app.ScriptSplitWorker;
import com.acttub.actingapi.platform.observability.FailureContext;
import com.acttub.actingapi.platform.observability.FailureReporter;
import jakarta.annotation.PreDestroy;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * 대본 나누기 큐를 비운다 (reading.script 「나누기 작업」). 영상 분석·기억·챌린지 리포트와 섞이지 않는 자기 스케줄러다 — 사용자가
 * 팝업에서 기다리므로 1초마다 본다. 유휴에는 선점 질의 하나만 나가고, 작업을 집으면 그때 다음 일꾼을 하나 더 띄워 동시 수(기본 4)
 * 까지 늘린다. 스위치는 분석 워커와 공유한다 — 넷 다 {@code ai_jobs} 를 소비하므로 "이 프로세스가 AI 큐의 주인인가"가 한 질문이다.
 * 테스트는 스위치를 끄고 {@code runOnce} 를 직접 부른다.
 *
 * <p>끌 때(배포)는 새 작업을 집지 않고 하던 작업을 {@link #DRAIN} 까지 기다린 뒤 인터럽트한다. 끊긴 작업은 일꾼이 대기로 돌려
 * 다음 서버가 이어 나눈다(SOMA-930). 이 빈이 장부·DB 에 기대므로 Spring 은 DataSource 보다 먼저 이 빈을 닫는다.
 */
@Component
@ConditionalOnProperty(name = "ANALYSIS_WORKER_ENABLED", havingValue = "true", matchIfMissing = true)
class ScriptSplitScheduler {
    private final ScriptSplitWorker worker;
    private final FailureReporter failures;
    private final Semaphore slots;
    /** compose {@code stop_grace_period: 40s} 안에서 HTTP 마무리와 반납할 시간을 남긴다. */
    static final Duration DRAIN = Duration.ofSeconds(20);
    private final Duration drain;
    private final ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor();
    private volatile boolean stopping;

    @Autowired
    ScriptSplitScheduler(ScriptSplitWorker worker, FailureReporter failures,
            @Value("${SCRIPT_SPLIT_CONCURRENCY:4}") int concurrency) {
        this(worker, failures, concurrency, DRAIN);
    }

    ScriptSplitScheduler(ScriptSplitWorker worker, FailureReporter failures, int concurrency, Duration drain) {
        this.worker = worker;
        this.failures = failures;
        this.slots = new Semaphore(concurrency);
        this.drain = drain;
    }

    @Scheduled(fixedDelayString = "${SCRIPT_SPLIT_POLL_INTERVAL_MS:1000}", initialDelayString = "${SCRIPT_SPLIT_INITIAL_DELAY_MS:15000}")
    void poll() {
        if (stopping) {
            return;
        }
        try {
            worker.sweep();
        } catch (RuntimeException failure) {
            failures.report(failure, new FailureContext("ScriptSplitScheduler.sweep"));
        }
        spawn();
    }

    /** 자리가 있으면 일꾼 하나. 일꾼은 작업을 집을 때마다 다음 일꾼을 부르고, 집을 게 없으면 자리를 내놓는다. */
    private void spawn() {
        if (stopping || !slots.tryAcquire()) {
            return;
        }
        try {
            executor.execute(() -> {
                try {
                    while (!stopping && worker.runOnce()) {
                        spawn();
                    }
                } catch (RuntimeException failure) {
                    failures.report(failure, new FailureContext("ScriptSplitScheduler.poll"));
                } finally {
                    slots.release();
                }
            });
        } catch (RejectedExecutionException closing) {
            // stopping 을 본 직후 꺼졌다 — 새 일꾼은 필요 없다.
            slots.release();
        }
    }

    @PreDestroy
    void shutdown() {
        stopping = true;
        executor.shutdown();
        try {
            if (!executor.awaitTermination(drain.toMillis(), TimeUnit.MILLISECONDS)) {
                executor.shutdownNow();
                // 인터럽트된 일꾼이 작업을 반납할 짧은 시간.
                executor.awaitTermination(5, TimeUnit.SECONDS);
            }
        } catch (InterruptedException interrupted) {
            executor.shutdownNow();
            Thread.currentThread().interrupt();
        }
    }
}
