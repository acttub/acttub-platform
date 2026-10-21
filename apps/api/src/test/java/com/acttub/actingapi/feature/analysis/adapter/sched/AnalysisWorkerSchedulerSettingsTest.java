package com.acttub.actingapi.feature.analysis.adapter.sched;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;

/** 분석 일꾼 설정: 동시 수와 주기는 양수여야 부팅된다. 주기는 밀리초로 반올림한다. */
class AnalysisWorkerSchedulerSettingsTest {
    @Test void nonPositiveSettingsStopTheBoot() {
        assertThatThrownBy(() -> AnalysisWorkerScheduler.analysisWorkerExecutor(0)).hasMessage("analysis worker settings must be positive");
        assertThatThrownBy(() -> AnalysisWorkerScheduler.analysisWorkerPollIntervalMillis(0.0)).hasMessage("analysis worker settings must be positive");
        assertThatThrownBy(() -> AnalysisWorkerScheduler.analysisSweepIntervalMillis(Double.NaN)).hasMessage("analysis worker settings must be positive");
    }

    @Test void intervalsAreRoundedToAtLeastOneMillisecond() {
        assertThat(AnalysisWorkerScheduler.analysisWorkerPollIntervalMillis(2.0)).isEqualTo(2000L);
        assertThat(AnalysisWorkerScheduler.analysisSweepIntervalMillis(0.0001)).isEqualTo(1L);
        assertThat(AnalysisWorkerScheduler.analysisWorkerExecutor(3).getMaxPoolSize()).isEqualTo(3);
    }
}
