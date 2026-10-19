package com.acttub.actingapi.platform.observability;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

import com.acttub.actingapi.support.RecordingFailureReporter;
import jakarta.persistence.EntityManager;
import jakarta.persistence.EntityManagerFactory;
import org.junit.jupiter.api.Test;
import org.springframework.boot.actuate.health.Status;

/**
 * DB 상태 확인은 2초 안에 답하고, 확인 하나가 돌고 있으면 겹쳐 부르지 않는다 — DB 가 멈춰도 상태 엔드포인트가
 * 따라 멈추거나 연결을 쌓지 않는다.
 */
class DatabaseHealthIndicatorTest {

    @Test
    void stuckDatabaseIsDownWithinTheDeadlineAndASecondProbeIsNotStacked() throws Exception {
        CountDownLatch release = new CountDownLatch(1);
        EntityManagerFactory factory = mock(EntityManagerFactory.class);
        when(factory.createEntityManager()).thenAnswer(invocation -> {
            release.await(10, TimeUnit.SECONDS);
            return mock(EntityManager.class);
        });
        RecordingFailureReporter reporter = new RecordingFailureReporter();
        MonitoringFailures failures = new MonitoringFailures(reporter);
        DatabaseHealthIndicator indicator = new DatabaseHealthIndicator(factory, failures);
        try {
            long started = System.nanoTime();
            assertThat(indicator.health().getStatus()).isEqualTo(Status.DOWN);
            long waited = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - started);

            assertThat(waited).isBetween(1_900L, 5_000L);
            for (int poll = 0; poll < 100 && reporter.contexts().isEmpty(); poll++) {
                Thread.sleep(20);
            }
            assertThat(reporter.contexts()).containsExactly("DatabaseHealthIndicator.timeout");
        } finally {
            release.countDown();
            indicator.destroy();
            failures.destroy();
        }
    }

    @Test
    void probeStillRunningMakesTheNextCheckDownImmediately() throws Exception {
        CountDownLatch entered = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        EntityManagerFactory factory = mock(EntityManagerFactory.class);
        when(factory.createEntityManager()).thenAnswer(invocation -> {
            entered.countDown();
            release.await(10, TimeUnit.SECONDS);
            return mock(EntityManager.class);
        });
        MonitoringFailures failures = new MonitoringFailures(new RecordingFailureReporter());
        DatabaseHealthIndicator indicator = new DatabaseHealthIndicator(factory, failures);
        Thread first = Thread.ofVirtual().start(indicator::health);
        try {
            assertThat(entered.await(5, TimeUnit.SECONDS)).isTrue();
            long started = System.nanoTime();

            assertThat(indicator.health().getStatus()).isEqualTo(Status.DOWN);
            assertThat(TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - started)).isLessThan(1_000L);
        } finally {
            release.countDown();
            first.join(5_000);
            indicator.destroy();
            failures.destroy();
        }
    }

    @Test
    void interruptedCallerGetsDownAndKeepsItsInterruptFlag() {
        CountDownLatch release = new CountDownLatch(1);
        EntityManagerFactory factory = mock(EntityManagerFactory.class);
        when(factory.createEntityManager()).thenAnswer(invocation -> {
            release.await(10, TimeUnit.SECONDS);
            return mock(EntityManager.class);
        });
        MonitoringFailures failures = new MonitoringFailures(new RecordingFailureReporter());
        DatabaseHealthIndicator indicator = new DatabaseHealthIndicator(factory, failures);
        Thread.currentThread().interrupt();
        try {
            assertThat(indicator.health().getStatus()).isEqualTo(Status.DOWN);
            assertThat(Thread.currentThread().isInterrupted()).isTrue();
        } finally {
            Thread.interrupted();
            release.countDown();
            indicator.destroy();
            failures.destroy();
        }
    }
}
