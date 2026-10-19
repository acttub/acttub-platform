package com.acttub.actingapi.feature.challenge.adapter.sched;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.acttub.actingapi.feature.challenge.app.NotificationPushWorker;
import com.acttub.actingapi.support.RecordingFailureReporter;
import org.junit.jupiter.api.Test;

/** 알림 푸시 예약: 밀린 묶음이 있으면 빌 때까지 이어 보내고, 실패는 보고한다. */
class NotificationPushSchedulerTest {
    final NotificationPushWorker worker = mock(NotificationPushWorker.class);
    final RecordingFailureReporter failures = new RecordingFailureReporter();
    final NotificationPushScheduler scheduler = new NotificationPushScheduler(worker, failures);

    @Test void sendsBatchesUntilNothingIsLeft() {
        when(worker.runOnce()).thenReturn(50, 3, 0);
        scheduler.run();
        verify(worker, times(3)).runOnce();
        assertThat(failures.reports()).isEmpty();
    }

    @Test void aFailedBatchIsReported() {
        when(worker.runOnce()).thenReturn(50).thenThrow(new IllegalStateException("fcm down"));
        scheduler.run();
        assertThat(failures.contexts()).containsExactly("NotificationPushScheduler.run");
    }
}
