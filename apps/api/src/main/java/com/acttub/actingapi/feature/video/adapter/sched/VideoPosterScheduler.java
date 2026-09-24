package com.acttub.actingapi.feature.video.adapter.sched;

import com.acttub.actingapi.feature.video.app.VideoPosterWorker;
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
 * 포스터가 빈 영상을 채운다 (practice.library). 새 영상과 이 기능 이전의 영상(백필)이 같은 길이다.
 *
 * <p><b>스위치가 둘이고 둘 다 켜져야 돈다.</b> {@code ANALYSIS_WORKER_ENABLED} 는 분석·기억·챌린지 리포트 워커와
 * 공유한다 — "이 프로세스가 뒤에서 도는 일의 주인인가" 가 한 질문이고, 격리 복원 검증은 그것 하나를 꺼서 저장소와
 * DB 에 쓰는 일을 모두 멈춘다(DEPLOY-HOME §7). {@code VIDEO_POSTER_ENABLED} 는 포스터만 끄는 스위치다 — 테스트가
 * 전역으로 끄고 워커를 직접 부른다.
 *
 * <p>ffmpeg 가 {@code FfmpegLock} 을 기다리는 동안 공용 스케줄러 스레드를 붙잡지 않도록 자기 스레드 하나에서 돈다.
 */
@Configuration(proxyBeanMethods = false)
@ConditionalOnProperty(
        name = {"ANALYSIS_WORKER_ENABLED", "VIDEO_POSTER_ENABLED"},
        havingValue = "true",
        matchIfMissing = true)
class VideoPosterScheduler {
    private final VideoPosterWorker worker;
    private final ThreadPoolTaskExecutor executor;
    private final FailureReporter failures;

    VideoPosterScheduler(
            VideoPosterWorker worker,
            @Qualifier("videoPosterExecutor") ThreadPoolTaskExecutor executor,
            FailureReporter failures) {
        this.worker = worker;
        this.executor = executor;
        this.failures = failures;
    }

    @Bean("videoPosterExecutor")
    static ThreadPoolTaskExecutor videoPosterExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(1);
        executor.setMaxPoolSize(1);
        executor.setQueueCapacity(0);
        executor.setThreadNamePrefix("video-poster-");
        executor.setDaemon(true);
        executor.setWaitForTasksToCompleteOnShutdown(true);
        return executor;
    }

    @Scheduled(
            fixedDelayString = "${VIDEO_POSTER_POLL_INTERVAL_MS:10000}",
            initialDelayString = "${VIDEO_POSTER_INITIAL_DELAY_MS:30000}")
    void poll() {
        if (executor.getActiveCount() > 0) {
            return;
        }
        try {
            executor.execute(this::drain);
        } catch (TaskRejectedException ignored) {
            // 이미 돌고 있으면 다음 폴에서 다시 본다.
        }
    }

    private void drain() {
        try {
            while (worker.runOnce()) {
                // 일감이 있는 동안은 기다리지 않는다 — 한 번에 한 영상이고 ffmpeg 락이 차례를 정한다.
            }
        } catch (RuntimeException failure) {
            failures.report(failure, new FailureContext("VideoPosterScheduler.drain"));
        }
    }
}
