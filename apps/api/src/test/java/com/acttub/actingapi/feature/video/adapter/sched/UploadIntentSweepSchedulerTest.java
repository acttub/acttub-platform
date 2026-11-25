package com.acttub.actingapi.feature.video.adapter.sched;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.acttub.actingapi.feature.video.app.VideoService;
import com.acttub.actingapi.platform.observability.FailureReporter;
import com.acttub.actingapi.support.RecordingFailureReporter;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.scheduling.annotation.Scheduled;

class UploadIntentSweepSchedulerTest {
    private final ApplicationContextRunner runner = new ApplicationContextRunner()
            .withUserConfiguration(UploadIntentSweepScheduler.class)
            .withBean(VideoService.class, () -> mock(VideoService.class))
            .withBean(FailureReporter.class, RecordingFailureReporter::new);

    /** 격리 복원은 {@code ANALYSIS_WORKER_ENABLED=false} 하나로 다른 워커와 이 정리를 함께 멈춘다. */
    @Test
    @DisplayName("practice.record 예약 정리: 분석 워커 스위치나 예약 정리 스위치 가운데 하나라도 꺼지면 스케줄러가 없다")
    void eitherSwitchTurnsTheSweepOff() {
        runner.withPropertyValues("ANALYSIS_WORKER_ENABLED=false")
                .run(context -> assertThat(context).doesNotHaveBean(UploadIntentSweepScheduler.class));
        runner.withPropertyValues("UPLOAD_INTENT_SWEEP_ENABLED=false")
                .run(context -> assertThat(context).doesNotHaveBean(UploadIntentSweepScheduler.class));
        runner.run(context -> assertThat(context).hasNotFailed().hasSingleBean(UploadIntentSweepScheduler.class));
    }

    @Test
    @DisplayName("practice.record 예약 정리: 옛 분석 워커의 정리와 같은 주기(기본 60초)로 돈다")
    void runsOnTheOldSweepInterval() throws Exception {
        Scheduled scheduled = UploadIntentSweepScheduler.class.getDeclaredMethod("run").getAnnotation(Scheduled.class);
        assertThat(scheduled.fixedDelayString()).isEqualTo("${UPLOAD_INTENT_SWEEP_INTERVAL_MS:60000}");
        assertThat(scheduled.initialDelayString()).isEqualTo("0");
    }

    @Test
    @DisplayName("practice.record 예약 정리: 닫을 예약이 없을 때까지 이어서 비운다")
    void drainsUntilNothingIsLeft() {
        VideoService videos = mock(VideoService.class);
        when(videos.sweepExpiredIntents()).thenReturn(200, 3, 0);
        RecordingFailureReporter reporter = new RecordingFailureReporter();

        new UploadIntentSweepScheduler(videos, reporter).run();

        verify(videos, times(3)).sweepExpiredIntents();
        assertThat(reporter.reports()).isEmpty();
    }

    @Test
    @DisplayName("practice.record 예약 정리: 실패는 스케줄러 밖으로 내지 않고 보고한다. 다음 주기에 다시 돈다")
    void reportsAFailureAndKeepsTheSchedule() {
        VideoService videos = mock(VideoService.class);
        IllegalStateException failure = new IllegalStateException("db down");
        when(videos.sweepExpiredIntents()).thenThrow(failure).thenReturn(0);
        RecordingFailureReporter reporter = new RecordingFailureReporter();
        UploadIntentSweepScheduler scheduler = new UploadIntentSweepScheduler(videos, reporter);

        scheduler.run();
        scheduler.run();

        assertThat(reporter.reports()).singleElement().satisfies(report -> {
            assertThat(report.failure()).isSameAs(failure);
            assertThat(report.context()).isEqualTo("UploadIntentSweepScheduler.run");
        });
        verify(videos, times(2)).sweepExpiredIntents();
    }
}
