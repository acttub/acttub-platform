package com.acttub.actingapi.feature.challenge.adapter.sched;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.timeout;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.acttub.actingapi.feature.challenge.app.ChallengeReportWorker;
import com.acttub.actingapi.support.RecordingFailureReporter;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import com.acttub.actingapi.platform.observability.ScheduledTaskLog;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;

class ChallengeReportSchedulerTest {
    final ChallengeReportWorker worker = mock(ChallengeReportWorker.class);
    final RecordingFailureReporter failures = new RecordingFailureReporter();
    final ChallengeReportScheduler scheduler = new ChallengeReportScheduler(worker, failures);

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
        assertThat(failures.contexts()).containsExactly("ChallengeReportScheduler.drain");
    }

    @Test
    void 비우기는_버려진_리포트를_먼저_닫고_닫기_실패도_drain_으로_알린다() {
        when(worker.runOnce()).thenReturn(true, false);
        scheduler.drain();
        var order = inOrder(worker);
        order.verify(worker).closeAbandoned();
        order.verify(worker, times(2)).runOnce();
        verify(worker, times(1)).closeAbandoned();

        when(worker.closeAbandoned()).thenThrow(new IllegalStateException("down"));
        scheduler.drain();
        verify(worker, times(2)).runOnce();
        assertThat(failures.contexts()).containsExactly("ChallengeReportScheduler.drain");
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

    @Test
    void 거절_보고_문맥과_비우기_로그_이름과_스레드_이름이_그대로다() throws Exception {
        ChallengeReportScheduler stopped = new ChallengeReportScheduler(worker, failures);
        stopped.shutdown();
        stopped.poll();
        assertThat(failures.contexts()).containsExactly("ChallengeReportScheduler.poll");

        Logger log = (Logger) LoggerFactory.getLogger(ScheduledTaskLog.class);
        ListAppender<ILoggingEvent> events = new ListAppender<>();
        events.start();
        log.addAppender(events);
        try {
            when(worker.runOnce()).thenReturn(true, false);
            scheduler.drain();
            assertThat(events.list).singleElement().satisfies(event -> assertThat(event.getKeyValuePairs())
                    .anySatisfy(pair -> assertThat(pair.key + "=" + pair.value).isEqualTo("task=ChallengeReportScheduler.drain")));
        } finally {
            log.detachAppender(events);
        }

        BlockingQueue<String> threads = new LinkedBlockingQueue<>();
        when(worker.runOnce()).thenAnswer(call -> {
            threads.add(Thread.currentThread().getName());
            return false;
        });
        scheduler.poll();
        assertThat(threads.poll(5, TimeUnit.SECONDS)).isEqualTo("challenge-report-worker");
    }
}
