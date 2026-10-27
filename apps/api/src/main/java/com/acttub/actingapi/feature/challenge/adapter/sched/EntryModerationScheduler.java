package com.acttub.actingapi.feature.challenge.adapter.sched;

import com.acttub.actingapi.feature.challenge.app.EntryModerationWorker;
import com.acttub.actingapi.platform.observability.FailureContext;
import com.acttub.actingapi.platform.observability.FailureReporter;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.task.TaskRejectedException;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

/**
 * 공개 참여작 AI 검사 (SOMA-907).
 *
 * <p>스위치가 둘이고 둘 다 켜져야 돈다 — {@code ANALYSIS_WORKER_ENABLED}(뒤에서 도는 일의 주인)와
 * {@code CHALLENGE_MODERATION_ENABLED}(검사만). 테스트는 후자를 전역으로 끄고 워커를 직접 부른다. 모델이 영상을
 * 처리하길 기다리는 동안 공용 스케줄러 스레드를 붙잡지 않도록 자기 스레드 하나에서 돈다.
 */
@Configuration(proxyBeanMethods = false)
@ConditionalOnProperty(name = {"ANALYSIS_WORKER_ENABLED", "CHALLENGE_MODERATION_ENABLED"}, havingValue = "true", matchIfMissing = true)
class EntryModerationScheduler {
    private final EntryModerationWorker worker;
    private final ThreadPoolTaskExecutor executor;
    private final FailureReporter failures;

    EntryModerationScheduler(EntryModerationWorker worker, @Qualifier("entryModerationExecutor") ThreadPoolTaskExecutor executor,
                             FailureReporter failures) {
        this.worker = worker; this.executor = executor; this.failures = failures;
    }

    @Bean("entryModerationExecutor")
    static ThreadPoolTaskExecutor entryModerationExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(1);
        executor.setMaxPoolSize(1);
        executor.setQueueCapacity(0);
        executor.setThreadNamePrefix("entry-moderation-");
        executor.setDaemon(true);
        executor.setWaitForTasksToCompleteOnShutdown(true);
        return executor;
    }

    @Scheduled(fixedDelayString = "${CHALLENGE_MODERATION_POLL_INTERVAL_MS:10000}",
            initialDelayString = "${CHALLENGE_MODERATION_INITIAL_DELAY_MS:30000}")
    void poll() {
        if (executor.getActiveCount() > 0) return;
        try {
            executor.execute(this::drain);
        } catch (TaskRejectedException ignored) {
            // 이미 돌고 있으면 다음 폴에서 다시 본다.
        }
    }

    private void drain() {
        try {
            while (worker.runOnce()) {
                // 일감이 있는 동안은 기다리지 않는다 — 한 번에 한 참여작이다.
            }
        } catch (RuntimeException failure) {
            failures.report(failure, new FailureContext("EntryModerationScheduler.drain"));
        }
    }
}
