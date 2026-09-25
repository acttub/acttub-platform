package com.acttub.actingapi.feature.video.adapter.sched;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.acttub.actingapi.feature.video.app.VideoPosterWorker;
import com.acttub.actingapi.support.RecordingFailureReporter;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

class VideoPosterSchedulerTest {
    private final ApplicationContextRunner runner = new ApplicationContextRunner()
            .withUserConfiguration(VideoPosterScheduler.class)
            .withBean(VideoPosterWorker.class, () -> mock(VideoPosterWorker.class))
            .withBean(RecordingFailureReporter.class, RecordingFailureReporter::new);

    /**
     * 격리 복원 검증은 {@code ANALYSIS_WORKER_ENABLED=false} 하나로 뒤에서 도는 일을 모두 멈춘다 — 포스터 워커가 그
     * 스위치를 따르지 않으면 복원한 DB 의 영상을 집어 저장소에 쓴다.
     */
    @Test
    @DisplayName("practice.library 포스터: 분석 워커 스위치나 포스터 스위치 가운데 하나라도 꺼지면 스케줄러가 없다")
    void eitherSwitchTurnsThePosterSchedulerOff() {
        runner.withPropertyValues("ANALYSIS_WORKER_ENABLED=false")
                .run(context -> assertThat(context).doesNotHaveBean(VideoPosterScheduler.class)
                        .doesNotHaveBean("videoPosterExecutor"));
        runner.withPropertyValues("VIDEO_POSTER_ENABLED=false")
                .run(context -> assertThat(context).doesNotHaveBean(VideoPosterScheduler.class));
        runner.run(context -> {
            assertThat(context).hasNotFailed().hasSingleBean(VideoPosterScheduler.class);
            ThreadPoolTaskExecutor executor = context.getBean("videoPosterExecutor", ThreadPoolTaskExecutor.class);
            assertThat(executor.getMaxPoolSize()).isEqualTo(1);
            assertThat(executor.getThreadNamePrefix()).isEqualTo("video-poster-");
            assertThat(executor.isDaemon()).isTrue();
        });
    }

    @Test
    @DisplayName("practice.library 포스터: 일감이 있는 동안 비우고, 워커 밖으로 새어 나온 실패는 보고한다")
    void drainsUntilIdleAndReportsEscapedFailures() {
        VideoPosterWorker worker = mock(VideoPosterWorker.class);
        when(worker.runOnce()).thenReturn(true, true, false);
        RecordingFailureReporter reporter = new RecordingFailureReporter();
        ThreadPoolTaskExecutor executor = inline();

        new VideoPosterScheduler(worker, executor, reporter).poll();

        verify(worker, times(3)).runOnce();
        assertThat(reporter.reports()).isEmpty();

        RuntimeException failure = new IllegalStateException("database is gone");
        when(worker.runOnce()).thenThrow(failure);
        new VideoPosterScheduler(worker, executor, reporter).poll();
        assertThat(reporter.reports()).singleElement().satisfies(report -> {
            assertThat(report.failure()).isSameAs(failure);
            assertThat(report.context()).isEqualTo("VideoPosterScheduler.drain");
        });
    }

    private static ThreadPoolTaskExecutor inline() {
        ThreadPoolTaskExecutor executor = mock(ThreadPoolTaskExecutor.class);
        when(executor.getActiveCount()).thenReturn(0);
        doAnswer(invocation -> {
            invocation.getArgument(0, Runnable.class).run();
            return null;
        }).when(executor).execute(any(Runnable.class));
        return executor;
    }
}
