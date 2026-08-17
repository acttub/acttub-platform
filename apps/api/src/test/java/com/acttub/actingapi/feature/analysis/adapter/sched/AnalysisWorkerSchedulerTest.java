package com.acttub.actingapi.feature.analysis.adapter.sched;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

class AnalysisWorkerSchedulerTest {
    private final ApplicationContextRunner runner = new ApplicationContextRunner()
            .withUserConfiguration(AnalysisWorkerScheduler.class);

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
}
