package com.acttub.actingapi.feature.reading.adapter.sched;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.timeout;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.acttub.actingapi.feature.reading.app.PronunciationWorker;
import com.acttub.actingapi.support.RecordingFailureReporter;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

class PronunciationWorkerSchedulerTest {
    final PronunciationWorker worker = mock(PronunciationWorker.class);
    final RecordingFailureReporter failures = new RecordingFailureReporter();
    final PronunciationWorkerScheduler scheduler = new PronunciationWorkerScheduler(worker, failures);

    @AfterEach
    void stop() {
        scheduler.shutdown();
    }

    @Test
    void 비우기는_집을_것이_없을_때까지_돈다() {
        when(worker.runOnce()).thenReturn(true, true, false);
        scheduler.drain();
        verify(worker, times(3)).runOnce();
        assertThat(failures.reports()).isEmpty();
    }

    @Test
    void 비우기_실패는_알리고_멈춘다() {
        when(worker.runOnce()).thenThrow(new IllegalStateException("down"));
        scheduler.drain();
        verify(worker, times(1)).runOnce();
        assertThat(failures.contexts()).containsExactly("PronunciationWorkerScheduler.drain");
    }

    @Test
    void 폴은_비우기를_기다리지_않고_돌고_있으면_하나_더_띄우지_않는다() throws Exception {
        CountDownLatch started = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        when(worker.runOnce()).thenAnswer(call -> {
            started.countDown();
            release.await(5, TimeUnit.SECONDS);
            return false;
        });

        long begin = System.nanoTime();
        scheduler.poll();
        assertThat(started.await(5, TimeUnit.SECONDS)).isTrue();
        scheduler.poll();
        scheduler.poll();
        assertThat(TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - begin)).isLessThan(4_000);
        verify(worker, times(1)).runOnce();

        release.countDown();
        for (int i = 0; i < 50; i++) {
            scheduler.poll();
            Thread.sleep(20);
        }
        verify(worker, timeout(2_000).atLeast(2)).runOnce();
        assertThat(failures.reports()).isEmpty();
    }
}
