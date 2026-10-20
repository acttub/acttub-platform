package com.acttub.actingapi.feature.challenge.adapter.sched;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.acttub.actingapi.feature.challenge.app.ChallengeReportWorker;
import com.acttub.actingapi.support.RecordingFailureReporter;
import org.junit.jupiter.api.Test;

/** 챌린지 AI 리포트 예약: 일감이 있는 동안 쉬지 않고 돌리고, 실패는 보고한다. */
class ChallengeReportSchedulerTest {
    final ChallengeReportWorker worker = mock(ChallengeReportWorker.class);
    final RecordingFailureReporter failures = new RecordingFailureReporter();
    final ChallengeReportScheduler scheduler = new ChallengeReportScheduler(worker, failures);

    @Test void drainsWhileThereIsWork() {
        when(worker.runOnce()).thenReturn(true, true, false);
        scheduler.poll();
        verify(worker, times(3)).runOnce();
        assertThat(failures.reports()).isEmpty();
    }

    @Test void aFailedRunIsReported() {
        when(worker.runOnce()).thenThrow(new IllegalStateException("lease lost"));
        scheduler.poll();
        assertThat(failures.contexts()).containsExactly("ChallengeReportScheduler.poll");
    }
}
