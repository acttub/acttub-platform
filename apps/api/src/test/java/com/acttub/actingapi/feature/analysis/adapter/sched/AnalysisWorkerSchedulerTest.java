package com.acttub.actingapi.feature.analysis.adapter.sched;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.acttub.actingapi.feature.analysis.app.AnalysisWorker;
import com.acttub.actingapi.support.RecordingFailureReporter;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.core.task.TaskRejectedException;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

class AnalysisWorkerSchedulerTest {
    private final ApplicationContextRunner runner = new ApplicationContextRunner()
            .withUserConfiguration(AnalysisWorkerScheduler.class)
            .withBean(RecordingFailureReporter.class, RecordingFailureReporter::new);

    @Test
    void disabledSwitchNeverCreatesBackgroundPool() {
        runner.withPropertyValues("ANALYSIS_WORKER_ENABLED=false")
                .run(context -> assertThat(context)
                        .doesNotHaveBean("analysisWorkerExecutor"));
    }

    @Test
    void enabledPoolUsesConfiguredDaemonConcurrency() {
        runner.withPropertyValues("ANALYSIS_WORKER_CONCURRENCY=3")
                .run(context -> {
                    assertThat(context).hasNotFailed();
                    ThreadPoolTaskExecutor executor = context.getBean(
                            "analysisWorkerExecutor", ThreadPoolTaskExecutor.class);
                    assertThat(executor.getCorePoolSize()).isEqualTo(3);
                    assertThat(executor.getMaxPoolSize()).isEqualTo(3);
                    assertThat(executor.getThreadNamePrefix()).isEqualTo("analysis-worker-");
                    assertThat(executor.isDaemon()).isTrue();
                });
    }

    @Test
    void cycleAndSweepFailuresAreReported() {
        AnalysisWorker worker = mock(AnalysisWorker.class);
        RuntimeException cycleFailure = new IllegalStateException("cycle failed");
        RuntimeException sweepFailure = new IllegalStateException("sweep failed");
        when(worker.runOnce()).thenThrow(cycleFailure);
        when(worker.sweep()).thenThrow(sweepFailure);

        RecordingFailureReporter reporter = new RecordingFailureReporter();
        ThreadPoolTaskExecutor executor = mock(ThreadPoolTaskExecutor.class);
        when(executor.getMaxPoolSize()).thenReturn(1);
        when(executor.getActiveCount()).thenReturn(0);
        doAnswer(invocation -> {
            invocation.getArgument(0, Runnable.class).run();
            return null;
        }).when(executor).execute(any(Runnable.class));

        AnalysisWorkerScheduler scheduler = scheduler(worker, executor, reporter);
        scheduler.poll();
        scheduler.sweep();

        assertThat(reporter.reports())
                .extracting(RecordingFailureReporter.Report::failure)
                .containsExactly(cycleFailure, sweepFailure);
        assertThat(reporter.reports())
                .extracting(RecordingFailureReporter.Report::context)
                .containsExactly(
                        "AnalysisWorkerScheduler.cycle",
                        "AnalysisWorkerScheduler.sweep");
    }

    @Test
    void aRejectedDrainTaskIsNotReported() {
        AnalysisWorker worker = mock(AnalysisWorker.class);
        RecordingFailureReporter reporter = new RecordingFailureReporter();
        ThreadPoolTaskExecutor executor = mock(ThreadPoolTaskExecutor.class);
        when(executor.getMaxPoolSize()).thenReturn(1);
        when(executor.getActiveCount()).thenReturn(0);
        doThrow(new TaskRejectedException("full"))
                .when(executor).execute(any(Runnable.class));

        scheduler(worker, executor, reporter).poll();

        assertThat(reporter.reports()).isEmpty();
    }

    @SuppressWarnings("unchecked")
    private static AnalysisWorkerScheduler scheduler(
            AnalysisWorker worker,
            ThreadPoolTaskExecutor executor,
            RecordingFailureReporter reporter) {
        ObjectProvider<AnalysisWorker> provider = mock(ObjectProvider.class);
        when(provider.getIfAvailable()).thenReturn(worker);
        return new AnalysisWorkerScheduler(provider, executor, reporter);
    }
}
