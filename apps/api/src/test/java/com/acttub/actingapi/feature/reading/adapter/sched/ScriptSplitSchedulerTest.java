package com.acttub.actingapi.feature.reading.adapter.sched;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.timeout;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Duration;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;

import com.acttub.actingapi.feature.reading.app.ScriptSplitWorker;
import com.acttub.actingapi.support.RecordingFailureReporter;
import org.junit.jupiter.api.Test;

/** 대본 나누기 예약: 정리 실패도 일꾼을 막지 않고, 일꾼은 자리 수만큼만 동시에 돈다. 끌 때는 새 작업을 집지 않고 하던 일을 기한까지 기다린다(SOMA-930). */
class ScriptSplitSchedulerTest {
    final ScriptSplitWorker worker = mock(ScriptSplitWorker.class);
    final RecordingFailureReporter failures = new RecordingFailureReporter();

    @Test void aFailedSweepIsReportedAndAFailedJobFreesItsSlot() throws Exception {
        doThrow(new IllegalStateException("sweep failed")).when(worker).sweep();
        when(worker.runOnce()).thenThrow(new IllegalStateException("model down"));
        var scheduler = new ScriptSplitScheduler(worker, failures, 1);
        try {
            scheduler.poll();
            verify(worker, timeout(5000)).runOnce();
            long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5);
            while (failures.reports().size() < 2 && System.nanoTime() < deadline) Thread.onSpinWait();
            assertThat(failures.contexts()).containsExactlyInAnyOrder("ScriptSplitScheduler.sweep", "ScriptSplitScheduler.poll");
        } finally {
            scheduler.shutdown();
        }
    }

    @Test void noMoreWorkersStartThanThereAreSlots() throws Exception {
        var running = new AtomicInteger();
        var peak = new AtomicInteger();
        var release = new CountDownLatch(1);
        var jobs = new AtomicInteger(3);
        when(worker.runOnce()).thenAnswer(call -> {
            if (jobs.getAndDecrement() <= 0) return false;
            peak.accumulateAndGet(running.incrementAndGet(), Math::max);
            release.await(5, TimeUnit.SECONDS);
            running.decrementAndGet();
            return true;
        });
        var scheduler = new ScriptSplitScheduler(worker, failures, 1);
        try {
            scheduler.poll();
            scheduler.poll();
            release.countDown();
            verify(worker, timeout(5000).atLeast(4)).runOnce();
            assertThat(peak.get()).isEqualTo(1);
            assertThat(failures.reports()).isEmpty();
        } finally {
            scheduler.shutdown();
        }
    }

    @Test void aStoppingSchedulerStartsNoNewWork() throws Exception {
        var scheduler = new ScriptSplitScheduler(worker, failures, 1);
        scheduler.shutdown();
        scheduler.poll();
        Thread.sleep(100);
        verify(worker, never()).runOnce();
    }

    @Test void shutdownWaitsForAJobThatFinishesInTimeAndDoesNotTakeAnother() throws Exception {
        var started = new CountDownLatch(1);
        var finish = new CountDownLatch(1);
        var interrupted = new AtomicBoolean();
        var calls = new AtomicInteger();
        when(worker.runOnce()).thenAnswer(call -> {
            calls.incrementAndGet();
            started.countDown();
            try {
                finish.await();
            } catch (InterruptedException e) {
                interrupted.set(true);
            }
            return true;
        });
        var scheduler = new ScriptSplitScheduler(worker, failures, 1, Duration.ofSeconds(5));
        scheduler.poll();
        assertThat(started.await(5, TimeUnit.SECONDS)).isTrue();
        var stopper = Thread.ofVirtual().start(scheduler::shutdown);
        Thread.sleep(100);
        assertThat(stopper.isAlive()).isTrue();
        finish.countDown();
        stopper.join(5000);
        assertThat(stopper.isAlive()).isFalse();
        assertThat(interrupted).isFalse();
        assertThat(calls.get()).isEqualTo(1);
    }

    @Test void shutdownInterruptsAJobThatOutlivesTheWait() throws Exception {
        var started = new CountDownLatch(1);
        var interrupted = new CountDownLatch(1);
        when(worker.runOnce()).thenAnswer(call -> {
            started.countDown();
            try {
                new CountDownLatch(1).await();
            } catch (InterruptedException e) {
                interrupted.countDown();
            }
            return true;
        });
        var scheduler = new ScriptSplitScheduler(worker, failures, 1, Duration.ofMillis(100));
        scheduler.poll();
        assertThat(started.await(5, TimeUnit.SECONDS)).isTrue();
        scheduler.shutdown();
        assertThat(interrupted.await(5, TimeUnit.SECONDS)).isTrue();
    }
}
