package com.acttub.actingapi.feature.memory.adapter.sched;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.acttub.actingapi.feature.memory.app.MemoryUpdateWorker;
import com.acttub.actingapi.support.RecordingFailureReporter;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.core.task.TaskRejectedException;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

class MemoryWorkerSchedulerTest {
    private final ApplicationContextRunner runner = new ApplicationContextRunner()
            .withUserConfiguration(MemoryWorkerScheduler.class)
            .withBean(RecordingFailureReporter.class, RecordingFailureReporter::new);

    /**
     * 분석 워커와 스위치를 공유한다 — 같은 {@code external_operations} 큐를 소비하므로
     * "이 프로세스가 큐 owner인가"가 하나의 질문이다. 스위치를 나누면 한쪽만 켠 프로세스가
     * 생겨 두 소비자가 같은 잡을 나눠 집는다.
     */
    @Test
    @DisplayName("꺼진 스위치는 기억 갱신 풀을 만들지 않는다")
    void disabledSwitchNeverCreatesBackgroundPool() {
        runner.withPropertyValues("ANALYSIS_WORKER_ENABLED=false")
                .run(context -> assertThat(context)
                        .doesNotHaveBean("memoryWorkerExecutor"));
    }

    @Test
    @DisplayName("기억 갱신은 데몬 한 칸으로만 돈다")
    void enabledPoolRunsOnASingleDaemonSlot() {
        runner.run(context -> {
            assertThat(context).hasNotFailed();
            ThreadPoolTaskExecutor executor = context.getBean(
                    "memoryWorkerExecutor", ThreadPoolTaskExecutor.class);
            assertThat(executor.getCorePoolSize()).isEqualTo(1);
            assertThat(executor.getMaxPoolSize()).isEqualTo(1);
            assertThat(executor.getThreadNamePrefix()).isEqualTo("memory-worker-");
            assertThat(executor.isDaemon()).isTrue();
        });
    }

    @Test
    void cycleFailureIsReported() {
        MemoryUpdateWorker worker = mock(MemoryUpdateWorker.class);
        RuntimeException failure = new IllegalStateException("cycle failed");
        when(worker.runOnce()).thenThrow(failure);
        RecordingFailureReporter reporter = new RecordingFailureReporter();
        ThreadPoolTaskExecutor executor = mock(ThreadPoolTaskExecutor.class);
        when(executor.getActiveCount()).thenReturn(0);
        doAnswer(invocation -> {
            invocation.getArgument(0, Runnable.class).run();
            return null;
        }).when(executor).execute(any(Runnable.class));

        scheduler(worker, executor, reporter).poll();

        assertThat(reporter.reports()).singleElement().satisfies(report -> {
            assertThat(report.failure()).isSameAs(failure);
            assertThat(report.context()).isEqualTo("MemoryWorkerScheduler.cycle");
        });
    }

    @Test
    void rejectedDrainTaskIsNotReported() {
        MemoryUpdateWorker worker = mock(MemoryUpdateWorker.class);
        RecordingFailureReporter reporter = new RecordingFailureReporter();
        ThreadPoolTaskExecutor executor = mock(ThreadPoolTaskExecutor.class);
        when(executor.getActiveCount()).thenReturn(0);
        doThrow(new TaskRejectedException("full"))
                .when(executor).execute(any(Runnable.class));

        scheduler(worker, executor, reporter).poll();

        assertThat(reporter.reports()).isEmpty();
    }

    @SuppressWarnings("unchecked")
    private static MemoryWorkerScheduler scheduler(
            MemoryUpdateWorker worker,
            ThreadPoolTaskExecutor executor,
            RecordingFailureReporter reporter) {
        ObjectProvider<MemoryUpdateWorker> provider = mock(ObjectProvider.class);
        when(provider.getIfAvailable()).thenReturn(worker);
        return new MemoryWorkerScheduler(provider, executor, reporter);
    }
}
