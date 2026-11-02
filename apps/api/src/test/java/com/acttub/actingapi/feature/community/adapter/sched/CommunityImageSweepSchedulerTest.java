package com.acttub.actingapi.feature.community.adapter.sched;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;

import com.acttub.actingapi.feature.community.app.CommunityImageService;
import com.acttub.actingapi.support.RecordingFailureReporter;
import org.junit.jupiter.api.Test;

/** 예약 작업이 한 번 실패해도 예외를 밖으로 던지지 않고 실패만 보고해, 다음 예약 실행이 이어진다. */
class CommunityImageSweepSchedulerTest {
    final CommunityImageService target = mock(CommunityImageService.class);
    final RecordingFailureReporter failures = new RecordingFailureReporter();
    final CommunityImageSweepScheduler scheduler = new CommunityImageSweepScheduler(target, failures);

    @Test void aFailedRunIsReportedAndSwallowed() {
        var failure = new IllegalStateException("db down");
        doThrow(failure).when(target).sweepUnattached();
        scheduler.run();
        assertThat(failures.reports()).singleElement().satisfies(report -> {
            assertThat(report.failure()).isSameAs(failure);
            assertThat(report.context()).isEqualTo("CommunityImageSweepScheduler.run");
        });
    }

    @Test void aSuccessfulRunReportsNothing() {
        scheduler.run();
        verify(target).sweepUnattached();
        assertThat(failures.reports()).isEmpty();
    }
}
