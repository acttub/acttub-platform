package com.acttub.actingapi.feature.challenge.adapter.sched;

import com.acttub.actingapi.feature.challenge.app.EntryMosaicWorker;
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
 * 얼굴 모자이크를 켠 참여작의 모자이크본을 만든다 (challenge.entry 얼굴 모자이크).
 *
 * <p>스위치가 둘이고 둘 다 켜져야 돈다 — {@code ANALYSIS_WORKER_ENABLED}(뒤에서 도는 일의 주인, 포스터·리포트 워커와
 * 공유)와 {@code CHALLENGE_MOSAIC_ENABLED}(모자이크만). 테스트는 후자를 전역으로 끄고 워커를 직접 부른다. ffmpeg 가
 * {@code FfmpegLock} 을 기다리는 동안 공용 스케줄러 스레드를 붙잡지 않도록 자기 스레드 하나에서 돈다.
 */
@Configuration(proxyBeanMethods = false)
@ConditionalOnProperty(name = {"ANALYSIS_WORKER_ENABLED", "CHALLENGE_MOSAIC_ENABLED"}, havingValue = "true", matchIfMissing = true)
class EntryMosaicScheduler {
    private final EntryMosaicWorker worker;
    private final ThreadPoolTaskExecutor executor;
    private final FailureReporter failures;

    EntryMosaicScheduler(EntryMosaicWorker worker, @Qualifier("entryMosaicExecutor") ThreadPoolTaskExecutor executor,
                         FailureReporter failures) {
        this.worker = worker; this.executor = executor; this.failures = failures;
    }

    @Bean("entryMosaicExecutor")
    static ThreadPoolTaskExecutor entryMosaicExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(1);
        executor.setMaxPoolSize(1);
        executor.setQueueCapacity(0);
        executor.setThreadNamePrefix("entry-mosaic-");
        executor.setDaemon(true);
        executor.setWaitForTasksToCompleteOnShutdown(true);
        return executor;
    }

    @Scheduled(fixedDelayString = "${CHALLENGE_MOSAIC_POLL_INTERVAL_MS:10000}",
            initialDelayString = "${CHALLENGE_MOSAIC_INITIAL_DELAY_MS:30000}")
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
                // 일감이 있는 동안은 기다리지 않는다 — 한 번에 한 참여작이고 ffmpeg 락이 차례를 정한다.
            }
        } catch (RuntimeException failure) {
            failures.report(failure, new FailureContext("EntryMosaicScheduler.drain"));
        }
    }
}
