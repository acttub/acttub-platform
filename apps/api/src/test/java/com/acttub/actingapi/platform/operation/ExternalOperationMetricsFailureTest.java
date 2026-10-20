package com.acttub.actingapi.platform.operation;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.platform.ledger.ExternalOperationExecution;
import com.acttub.actingapi.platform.ledger.ExternalOperationMonitoring;
import com.acttub.actingapi.platform.observability.MonitoringFailures;
import com.acttub.actingapi.support.RecordingFailureReporter;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import jakarta.persistence.EntityManager;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.transaction.CannotCreateTransactionException;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/**
 * 관측이 실패해도 원래 일은 그대로 간다 — 실패는 보고만 하고, 커밋 뒤에만 센다 (CONTRACT §6-4).
 */
class ExternalOperationMetricsFailureTest {
    private static final Instant CREATED = Instant.parse("2026-10-20T00:00:00Z");
    private static final Instant NOW = Instant.parse("2026-10-20T00:00:05Z");

    private final SimpleMeterRegistry registry = new SimpleMeterRegistry();
    private final RecordingFailureReporter reporter = new RecordingFailureReporter();
    private final MonitoringFailures failures = new MonitoringFailures(reporter);
    private final PlatformTransactionManager transactions = mock(PlatformTransactionManager.class);

    private ExternalOperationMetrics metrics(Clock clock) {
        return new ExternalOperationMetrics(registry, mock(EntityManager.class), clock, transactions, failures);
    }

    @AfterEach
    void cleanUp() {
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.clearSynchronization();
        }
        failures.destroy();
    }

    private List<String> reportedContexts(int expected) throws InterruptedException {
        for (int poll = 0; poll < 100 && reporter.contexts().size() < expected; poll++) {
            Thread.sleep(20);
        }
        return reporter.contexts();
    }

    private static void commit() {
        List<TransactionSynchronization> synchronizations = TransactionSynchronizationManager.getSynchronizations();
        synchronizations.forEach(TransactionSynchronization::afterCommit);
    }

    private double terminalCount(String kind, String outcome, String classification) {
        return registry.get("acttub.external.operations.terminal")
                .tags("kind", kind, "outcome", outcome, "classification", classification).counter().count();
    }

    @Test
    void terminalOutcomeIsCountedOnlyAfterCommit() {
        TransactionSynchronizationManager.initSynchronization();
        ExternalOperationMetrics metrics = metrics(Clock.fixed(NOW, ZoneOffset.UTC));

        metrics.terminal(new ExternalOperationMonitoring.Terminal(UUID.randomUUID(), "report", "failed", null, CREATED));
        metrics.terminal(new ExternalOperationMonitoring.Terminal(UUID.randomUUID(), "report", "requeued", null, CREATED));
        assertThat(terminalCount("report", "failed", "unclassified")).isZero();

        commit();

        assertThat(terminalCount("report", "failed", "unclassified")).isEqualTo(1.0);
        assertThat(registry.get("acttub.external.operations.elapsed").tags("kind", "report", "outcome", "failed")
                .timer().count()).isEqualTo(1);
    }

    @Test
    void observationOutsideATransactionIsReportedInsteadOfThrown() throws Exception {
        ExternalOperationMetrics metrics = metrics(Clock.fixed(NOW, ZoneOffset.UTC));

        metrics.claimed(new ExternalOperationMonitoring.Claimed("analyze", CREATED, 1, NOW));

        assertThat(reportedContexts(1)).containsExactly("ExternalOperationMetrics.registration");
    }

    @Test
    void failingObservationAfterCommitIsReported() throws Exception {
        TransactionSynchronizationManager.initSynchronization();
        ExternalOperationMetrics metrics = metrics(Clock.fixed(NOW, ZoneOffset.UTC));
        metrics.terminal(new ExternalOperationMonitoring.Terminal(UUID.randomUUID(), "analyze", "succeeded", null, null));

        commit();

        assertThat(reportedContexts(1)).containsExactly("ExternalOperationMetrics.afterCommit");
        assertThat(terminalCount("analyze", "succeeded", "none")).isEqualTo(1.0);
    }

    @Test
    void brokenClockStillCountsTheOutcomeWithoutAnElapsedTime() throws Exception {
        TransactionSynchronizationManager.initSynchronization();
        Clock broken = mock(Clock.class);
        when(broken.instant()).thenThrow(new IllegalStateException("clock unavailable"));
        ExternalOperationMetrics metrics = metrics(broken);

        metrics.terminal(new ExternalOperationMonitoring.Terminal(UUID.randomUUID(), "coach_reply", "failed", "external", CREATED));
        commit();

        assertThat(reportedContexts(1)).containsExactly("ExternalOperationMetrics.terminalTime");
        assertThat(terminalCount("coach_reply", "failed", "external")).isEqualTo(1.0);
        assertThat(registry.get("acttub.external.operations.elapsed").tags("kind", "coach_reply", "outcome", "failed")
                .timer().count()).isZero();
    }

    @Test
    void executionThatCannotBeMarkedStartedIsNotObservedAndIsReported() throws Exception {
        when(transactions.getTransaction(any())).thenThrow(new CannotCreateTransactionException("pool exhausted"));
        ExternalOperationMetrics metrics = metrics(Clock.fixed(NOW, ZoneOffset.UTC));

        try (ExternalOperationExecution execution = metrics.execution(UUID.randomUUID(), UUID.randomUUID())) {
            ExternalOperationExecution.externalCall("model");
            ExternalOperationExecution.externalCall("storage");
        }

        assertThat(reportedContexts(1)).containsExactly("ExternalOperationMetrics.startExecution");
        assertThat(registry.get("acttub.external.operations.external.calls")
                .tags("kind", "analyze", "dependency", "model").counter().count()).isZero();
    }
}
