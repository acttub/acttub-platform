package com.acttub.actingapi.feature.video.adapter.sched;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.acttub.actingapi.feature.video.app.VideoPosterWorker;
import com.acttub.actingapi.support.RecordingFailureReporter;
import org.junit.jupiter.api.Test;
import org.springframework.core.task.TaskRejectedException;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

/** 포스터 예약: 이미 도는 중이면 새 일꾼을 넣지 않고, 자리가 막혀 거절돼도 다음 폴로 넘긴다. */
class VideoPosterSchedulerPollTest {
    final VideoPosterWorker worker = mock(VideoPosterWorker.class);
    final ThreadPoolTaskExecutor executor = mock(ThreadPoolTaskExecutor.class);
    final VideoPosterScheduler scheduler = new VideoPosterScheduler(worker, executor, new RecordingFailureReporter());

    @Test void aRunningDrainIsNotJoinedByAnother() {
        when(executor.getActiveCount()).thenReturn(1);
        scheduler.poll();
        verify(executor, never()).execute(any(Runnable.class));
    }

    @Test void aRejectedSubmissionWaitsForTheNextPoll() {
        doThrow(new TaskRejectedException("full")).when(executor).execute(any(Runnable.class));
        assertThatCode(scheduler::poll).doesNotThrowAnyException();
    }
}
