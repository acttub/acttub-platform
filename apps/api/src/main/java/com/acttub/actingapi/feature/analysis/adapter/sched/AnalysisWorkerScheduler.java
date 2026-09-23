package com.acttub.actingapi.feature.analysis.adapter.sched;

import java.util.logging.Level;
import java.util.logging.Logger;

import com.acttub.actingapi.feature.analysis.app.AnalysisWorker;
import com.acttub.actingapi.platform.observability.FailureContext;
import com.acttub.actingapi.platform.observability.FailureReporter;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.task.TaskRejectedException;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

/** Spring 스케줄러가 유휴 폴을 시작하고, 실제 일감은 제한된 데몬 풀에서 비운다. */
@Configuration(proxyBeanMethods = false)
@ConditionalOnProperty(
        name = "ANALYSIS_WORKER_ENABLED",
        havingValue = "true",
        matchIfMissing = true)
class AnalysisWorkerScheduler {
    private static final Logger LOGGER =
            Logger.getLogger(AnalysisWorkerScheduler.class.getName());

    /**
      * 원장마다 워커 하나다 — 옛 {@code external_operations} 와 1.0.0 의 {@code ai_jobs} (practice.analyze).
      * 둘은 서로 다른 큐를 집고 서로 다른 표에 쓰지만 lease·실패 분류 규칙은 한 벌이다(CONTRACT §5-7).
      * PA4 가 코치·노트를 회차로 옮기면 옛 워커가 사라진다.
      */
    private final java.util.List<AnalysisWorker> workers;
    private final ThreadPoolTaskExecutor executor;
    private final FailureReporter failureReporter;

    AnalysisWorkerScheduler(
            ObjectProvider<AnalysisWorker> worker,
            @Qualifier("analysisWorkerExecutor") ThreadPoolTaskExecutor executor,
            FailureReporter failureReporter) {
        this.workers = worker.orderedStream().toList();
        this.executor = executor;
        this.failureReporter = failureReporter;
    }

    @Bean("analysisWorkerExecutor")
    static ThreadPoolTaskExecutor analysisWorkerExecutor(
            @org.springframework.beans.factory.annotation.Value(
                    "${ANALYSIS_WORKER_CONCURRENCY:1}") int concurrency) {
        if (concurrency <= 0) {
            throw new IllegalStateException("analysis worker settings must be positive");
        }
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(concurrency);
        executor.setMaxPoolSize(concurrency);
        executor.setQueueCapacity(0);
        executor.setThreadNamePrefix("analysis-worker-");
        executor.setDaemon(true);
        executor.setWaitForTasksToCompleteOnShutdown(true);
        return executor;
    }

    @Bean("analysisWorkerPollIntervalMillis")
    static Long analysisWorkerPollIntervalMillis(
            @org.springframework.beans.factory.annotation.Value(
                    "${ANALYSIS_WORKER_POLL_INTERVAL_SEC:2.0}") double seconds) {
        return positiveMillis(seconds);
    }

    @Bean("analysisSweepIntervalMillis")
    static Long analysisSweepIntervalMillis(
            @org.springframework.beans.factory.annotation.Value(
                    "${ANALYSIS_SWEEP_INTERVAL_SEC:60.0}") double seconds) {
        return positiveMillis(seconds);
    }

    @Scheduled(
            fixedDelayString = "#{@analysisWorkerPollIntervalMillis}",
            initialDelayString = "0")
    void poll() {
        if (workers.isEmpty()) {
            return;
        }
        int openSlots = executor.getMaxPoolSize() - executor.getActiveCount();
        for (int index = 0; index < openSlots; index++) {
            try {
                executor.execute(this::drainQueue);
            } catch (TaskRejectedException ignored) {
                return;
            }
        }
    }

    @Scheduled(
            fixedDelayString = "#{@analysisSweepIntervalMillis}",
            initialDelayString = "0")
    void sweep() {
        // Python 풀의 index 0 역할이다. maintenance tick은 이 단일 메서드만 소유한다.
        for (AnalysisWorker worker : workers) {
            try {
                worker.sweep();
            } catch (Exception exception) {
                LOGGER.log(Level.WARNING, "analysis maintenance sweep failed", exception);
                failureReporter.report(
                        exception,
                        new FailureContext("AnalysisWorkerScheduler.sweep"));
            }
        }
    }

    private void drainQueue() {
        for (AnalysisWorker worker : workers) {
            try {
                while (worker.runOnce()) {
                    // 일감이 있는 동안은 대기하지 않는다.
                }
            } catch (Exception exception) {
                LOGGER.log(Level.WARNING, "analysis worker cycle failed", exception);
                failureReporter.report(
                        exception,
                        new FailureContext("AnalysisWorkerScheduler.cycle"));
            }
        }
    }

    private static long positiveMillis(double seconds) {
        if (!(seconds > 0)) {
            throw new IllegalStateException("analysis worker settings must be positive");
        }
        return Math.max(1L, Math.round(seconds * 1000d));
    }
}
