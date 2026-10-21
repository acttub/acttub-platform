package com.acttub.actingapi.feature.audition.adapter.sched;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;

import com.acttub.actingapi.feature.audition.app.AuditionService;
import com.acttub.actingapi.support.RecordingFailureReporter;
import org.junit.jupiter.api.Test;

/** 오디션 수집 예약: 정해진 시각 수집과 시작 직후 오래된 경우의 수집 모두 실패를 보고만 한다. */
class AuditionCollectSchedulerTest {
    final AuditionService auditions = mock(AuditionService.class);
    final RecordingFailureReporter failures = new RecordingFailureReporter();
    final AuditionCollectScheduler scheduler = new AuditionCollectScheduler(auditions, failures);

    @Test void bothCollectionsReportTheirOwnFailure() {
        doThrow(new IllegalStateException("source down")).when(auditions).collect();
        doThrow(new IllegalStateException("source down")).when(auditions).collectIfStale();
        scheduler.collect();
        scheduler.collectAfterStartupIfStale();
        assertThat(failures.contexts()).containsExactly(
                "AuditionCollectScheduler.collect", "AuditionCollectScheduler.collectAfterStartupIfStale");
    }

    @Test void successfulCollectionsReportNothing() {
        scheduler.collect();
        scheduler.collectAfterStartupIfStale();
        assertThat(failures.reports()).isEmpty();
    }
}
