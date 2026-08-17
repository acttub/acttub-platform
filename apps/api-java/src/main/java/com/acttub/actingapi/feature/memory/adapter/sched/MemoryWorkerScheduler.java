package com.acttub.actingapi.feature.memory.adapter.sched;

import java.util.logging.Level;
import java.util.logging.Logger;

import com.acttub.actingapi.feature.memory.app.MemoryUpdateWorker;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Profile;
import org.springframework.core.task.TaskRejectedException;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

/**
 * 기억 갱신 큐를 비운다. Python은 lifespan에서 {@code memory_worker.start()}를 부른다
 * ({@code app.py:create_app}).
 *
 * <p>주기 청소가 없어 sweep은 두지 않는다 — Python의
 * {@code memory_worker.py:MemoryUpdateWorker.sweep}도 빈 메서드이고, 분석이 쓰던 작업
 * 풀을 그대로 쓰기 위한 자리일 뿐이다.
 *
 * <p>스위치를 분석 워커와 공유한다. 둘은 같은 {@code external_operations} 큐를 소비하므로
 * "이 프로세스가 큐 owner인가"가 하나의 질문이다. 스위치를 나누면 컷오버에서 한쪽만
 * 넘기는 사고가 열린다 — 워커를 늘렸을 때 따라가지 못해 하네스가 비결정적으로 깨진
 * 전례가 이미 있다.
 */
@Configuration(proxyBeanMethods = false)
@Profile("!contract")
@ConditionalOnProperty(
        name = "ANALYSIS_WORKER_ENABLED",
        havingValue = "true",
        matchIfMissing = true)
class MemoryWorkerScheduler {
    private static final Logger LOGGER =
            Logger.getLogger(MemoryWorkerScheduler.class.getName());

    private final MemoryUpdateWorker worker;
    private final ThreadPoolTaskExecutor executor;

    MemoryWorkerScheduler(
            ObjectProvider<MemoryUpdateWorker> worker,
            @Qualifier("memoryWorkerExecutor") ThreadPoolTaskExecutor executor) {
        this.worker = worker.getIfAvailable();
        this.executor = executor;
    }

    /** Python이 concurrency를 1로 고정한다 — 연습 몇 번에 한 번만 잡이 생겨 밀리지 않는다. */
    @Bean("memoryWorkerExecutor")
    static ThreadPoolTaskExecutor memoryWorkerExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(1);
        executor.setMaxPoolSize(1);
        executor.setQueueCapacity(0);
        executor.setThreadNamePrefix("memory-worker-");
        executor.setDaemon(true);
        executor.setWaitForTasksToCompleteOnShutdown(true);
        return executor;
    }

    @Bean("memoryWorkerPollIntervalMillis")
    static Long memoryWorkerPollIntervalMillis(
            @Value("${ANALYSIS_WORKER_POLL_INTERVAL_SEC:2.0}") double seconds) {
        if (!(seconds > 0)) {
            throw new IllegalStateException("memory worker settings must be positive");
        }
        return Math.max(1L, Math.round(seconds * 1000d));
    }

    @Scheduled(
            fixedDelayString = "#{@memoryWorkerPollIntervalMillis}",
            initialDelayString = "0")
    void poll() {
        if (worker == null || executor.getActiveCount() > 0) {
            return;
        }
        try {
            executor.execute(this::drainQueue);
        } catch (TaskRejectedException ignored) {
            // 이미 돌고 있으면 다음 폴에서 다시 본다.
        }
    }

    private void drainQueue() {
        try {
            while (worker.runOnce()) {
                // 일감이 있는 동안은 대기하지 않는다.
            }
        } catch (Exception exception) {
            // 기억 갱신이 실패해도 연습은 정상이다. 큐만 비우고 넘어간다.
            LOGGER.log(Level.WARNING, "memory worker cycle failed", exception);
        }
    }
}
