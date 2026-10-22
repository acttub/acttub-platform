package com.acttub.actingapi.feature.challenge.adapter.sched;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import com.acttub.actingapi.feature.challenge.app.EntryMosaicWorker;
import com.acttub.actingapi.support.RecordingFailureReporter;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

class EntryMosaicSchedulerTest {
    private final ApplicationContextRunner runner = new ApplicationContextRunner()
            .withUserConfiguration(EntryMosaicScheduler.class)
            .withBean(EntryMosaicWorker.class, () -> mock(EntryMosaicWorker.class))
            .withBean(RecordingFailureReporter.class, RecordingFailureReporter::new);

    @Test
    @DisplayName("challenge.entry 얼굴 모자이크: 분석 워커 스위치나 모자이크 스위치 가운데 하나라도 꺼지면 스케줄러가 없다")
    void eitherSwitchTurnsTheMosaicSchedulerOff() {
        runner.withPropertyValues("ANALYSIS_WORKER_ENABLED=false")
                .run(context -> assertThat(context).doesNotHaveBean(EntryMosaicScheduler.class)
                        .doesNotHaveBean("entryMosaicExecutor"));
        runner.withPropertyValues("CHALLENGE_MOSAIC_ENABLED=false")
                .run(context -> assertThat(context).doesNotHaveBean(EntryMosaicScheduler.class));
        runner.run(context -> {
            assertThat(context).hasNotFailed().hasSingleBean(EntryMosaicScheduler.class);
            ThreadPoolTaskExecutor executor = context.getBean("entryMosaicExecutor", ThreadPoolTaskExecutor.class);
            assertThat(executor.getMaxPoolSize()).isEqualTo(1);
            assertThat(executor.getThreadNamePrefix()).isEqualTo("entry-mosaic-");
        });
    }

    @Test
    @DisplayName("challenge.entry 얼굴 모자이크: 일감이 있는 동안 비우고, 워커 밖으로 새어 나온 실패는 보고한다")
    void drainsUntilIdleAndReportsEscapedFailures() {
        EntryMosaicWorker worker = mock(EntryMosaicWorker.class);
        when(worker.runOnce()).thenReturn(true, true, false);
        RecordingFailureReporter reporter = new RecordingFailureReporter();
        ThreadPoolTaskExecutor executor = inline();

        new EntryMosaicScheduler(worker, executor, reporter).poll();

        verify(worker, times(3)).runOnce();
        assertThat(reporter.reports()).isEmpty();

        RuntimeException failure = new IllegalStateException("database is gone");
        when(worker.runOnce()).thenThrow(failure);
        new EntryMosaicScheduler(worker, executor, reporter).poll();
        assertThat(reporter.reports()).singleElement().satisfies(report -> {
            assertThat(report.failure()).isSameAs(failure);
            assertThat(report.context()).isEqualTo("EntryMosaicScheduler.drain");
        });

        ThreadPoolTaskExecutor busy = mock(ThreadPoolTaskExecutor.class);
        when(busy.getActiveCount()).thenReturn(1);
        new EntryMosaicScheduler(worker, busy, reporter).poll();
        verify(busy, times(0)).execute(any(Runnable.class));
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
