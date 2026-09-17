package com.acttub.actingapi.platform.operation;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.sql.Connection;
import java.sql.Statement;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import javax.sql.DataSource;

import com.acttub.actingapi.feature.coach.app.CoachOperationLedger;
import com.acttub.actingapi.feature.memory.app.MemoryUpdateQueue;
import com.acttub.actingapi.platform.ledger.LeaseOwnershipException;
import com.acttub.actingapi.platform.ledger.SyncOperationBegin;
import com.acttub.actingapi.platform.ledger.SyncOperationClaim;
import com.acttub.actingapi.platform.ledger.ExternalOperationExecution;
import com.acttub.actingapi.feature.practice.app.PracticeSessionLedger;
import com.acttub.actingapi.feature.practice.app.PracticeSessionOperation;
import com.acttub.actingapi.support.PostgresContainerSupport;
import com.acttub.actingapi.support.MonitoringFailureFixture;
import com.acttub.actingapi.platform.web.ApiException;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.hibernate.resource.jdbc.spi.StatementInspector;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.dao.DataAccessException;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

@SpringBootTest(properties = {"JWT_SECRET=test-secret", "EXTERNAL_OPERATION_SNAPSHOT_MS=25",
        "spring.jpa.properties.hibernate.session_factory.statement_inspector="
                + "com.acttub.actingapi.platform.operation.ExternalOperationIT$TransitionInspector"})
@Import(MonitoringFailureFixture.class)
class ExternalOperationIT {

    /** Controls extra reads and post-commit interleaving at the real PostgreSQL boundary.
     * Successful state-changing CTEs and their RETURNING rows stay untouched. */
    public static class TransitionInspector implements StatementInspector {
        private static final ThreadLocal<Integer> REMAINING = new ThreadLocal<>();
        private static final ThreadLocal<Runnable> AFTER_COMMIT = new ThreadLocal<>();

        @Override
        public String inspect(String sql) {
            Runnable afterCommit = AFTER_COMMIT.get();
            if (afterCommit != null) {
                AFTER_COMMIT.remove();
                org.springframework.transaction.support.TransactionSynchronizationManager.registerSynchronization(
                        new org.springframework.transaction.support.TransactionSynchronization() {
                            @Override
                            public void afterCommit() { afterCommit.run(); }
                        });
            }
            Integer remaining = REMAINING.get();
            if (remaining != null && sql.stripLeading().toLowerCase(java.util.Locale.ROOT).startsWith("select")) {
                REMAINING.set(remaining - 1);
                if (remaining == 0) {
                    // Preserve every original JDBC parameter while PostgreSQL aborts the transaction.
                    return sql.replaceFirst("(?is)^\\s*select\\s+", "SELECT 1 / 0 AS forced_read_failure, ");
                }
            }
            return sql;
        }
    }

    private static final Instant NOW = Instant.parse("2026-08-08T01:02:03.456789Z");
    private static final String FINGERPRINT = "a".repeat(64);
    private static final String OTHER_FINGERPRINT = "b".repeat(64);
    private static final long CREATION_LOCK = 287001L;
    private static final long RETRY_LOCK = 287002L;

    @DynamicPropertySource
    static void datasource(DynamicPropertyRegistry registry) {
        String database = PostgresContainerSupport.createDatabaseName("external_operation_it");
        registry.add("spring.datasource.url", () -> PostgresContainerSupport.jdbcUrlFor(database));
        registry.add("spring.datasource.username", PostgresContainerSupport.POSTGRES::getUsername);
        registry.add("spring.datasource.password", PostgresContainerSupport.POSTGRES::getPassword);
    }

    @Autowired
    JdbcTemplate jdbc;

    @Autowired
    DataSource dataSource;

    @Autowired
    ExternalOperationClaimer claimer;

    @Autowired
    PracticeSessionLedger store;

    @Autowired
    com.acttub.actingapi.feature.practice.app.PracticeSessionRepository practices;

    @Autowired
    com.acttub.actingapi.feature.analysis.app.AnalysisStore analyses;

    @Autowired
    CoachOperationLedger syncOperations;

    @Autowired
    MemoryUpdateQueue memoryQueue;

    @Autowired
    io.micrometer.core.instrument.MeterRegistry meters;

    @Autowired
    MonitoringFailureFixture.Sink reporting;

    @Autowired
    MonitoringFailureFixture.MetricClock metricClock;

    @BeforeEach
    void clearDatabase() {
        jdbc.execute("TRUNCATE TABLE users RESTART IDENTITY CASCADE");
    }

    @AfterEach
    void removeTestTriggers() {
        jdbc.execute("DROP TRIGGER IF EXISTS fail_claim_session_update ON practice_sessions");
        jdbc.execute("DROP FUNCTION IF EXISTS fail_claim_session_update()");
        jdbc.execute("DROP TRIGGER IF EXISTS block_creation_session_insert ON practice_sessions");
        jdbc.execute("DROP FUNCTION IF EXISTS block_creation_session_insert()");
        jdbc.execute("DROP TRIGGER IF EXISTS block_retry_operation_insert ON external_operations");
        jdbc.execute("DROP FUNCTION IF EXISTS block_retry_operation_insert()");
    }

    @ParameterizedTest
    @ValueSource(strings = {"claim", "claim-next", "requeue", "complete", "fail", "sweep"})
    void stateTransitionsDoNotDependOnAdditionalObservationReads(String transition) {
        UUID user = insertUser();
        UUID session = insertSession(user, insertFinalizedUpload(user), "analyzing", NOW);
        UUID operation = insertOperation(user, session, "coach_start", "pending", NOW.minusSeconds(10));
        UUID lease = UUID.randomUUID();
        if (!transition.startsWith("claim") && !transition.equals("sweep")) {
            claimer.claimById(operation, lease, Duration.ofMinutes(5), NOW);
        }
        if (transition.equals("sweep")) {
            jdbc.update("UPDATE external_operations SET attempt_count=3 WHERE id=?", operation);
        }
        java.util.function.DoubleSupplier observations = switch (transition) {
            case "claim", "claim-next" -> () -> meters.get("acttub.external.operations.wait")
                    .tags("kind", "coach_start", "waiting", "initial").timer().count();
            case "requeue" -> () -> meters.get("acttub.external.operations.requeues").tag("kind", "coach_start").counter().count();
            default -> () -> meters.get("acttub.external.operations.terminal").tags("kind", "coach_start",
                    "outcome", transition.equals("complete") ? "succeeded" : "failed",
                    "classification", transition.equals("complete") ? "none" : transition.equals("fail") ? "external" : "unclassified")
                    .counter().count();
        };
        double before = observations.getAsDouble();
        // fail already needs one business read to find the owning practice session.
        // The other transitions need only their conditional DML and returned values.
        TransitionInspector.REMAINING.set(transition.equals("fail") ? 1 : 0);
        try {
            switch (transition) {
                case "claim" -> assertThat(claimer.claimById(operation, lease, Duration.ofMinutes(5), NOW)).isEqualTo(operation);
                case "claim-next" -> assertThat(claimer.claimNext("coach_start", lease, Duration.ofMinutes(5), NOW)).isEqualTo(operation);
                case "requeue" -> assertThat(claimer.release(operation, lease, "external", NOW)).isTrue();
                case "complete" -> syncOperations.complete(new SyncOperationClaim(operation, lease, UUID.randomUUID()),
                        JsonNodeFactory.instance.objectNode().put("saved", true));
                case "fail" -> assertThat(claimer.fail(operation, lease, "fixture_failure", false, "external", NOW)).isTrue();
                case "sweep" -> assertThat(claimer.sweepMaxAttempts(NOW)).isEqualTo(1);
                default -> throw new AssertionError(transition);
            }
        } finally {
            TransitionInspector.REMAINING.remove();
        }
        assertThat(operation(operation).get("status")).isEqualTo(switch (transition) {
            case "claim", "claim-next" -> "running";
            case "requeue" -> "pending";
            case "complete" -> "succeeded";
            default -> "failed";
        });
        assertThat(observations.getAsDouble()).isEqualTo(before + 1);
    }

    @ParameterizedTest
    @ValueSource(strings = {"start", "complete"})
    void failedObservationTimingAndReportingCannotChangeTheSuccessfulCommit(String phase) {
        UUID user = insertUser();
        UUID session = insertSession(user, insertFinalizedUpload(user), "analyzing", NOW);
        UUID operation = insertOperation(user, session, "coach_start", "pending", NOW);
        UUID lease = UUID.randomUUID();
        claimer.claimById(operation, lease, Duration.ofMinutes(5), NOW);
        SyncOperationClaim claim = new SyncOperationClaim(operation, lease, UUID.randomUUID());
        var successes = meters.get("acttub.external.operations.terminal").tags(
                "kind", "coach_start", "outcome", "succeeded", "classification", "none").counter();
        double before = successes.count();
        RuntimeException cause = phase.equals("start")
                ? new IllegalStateException("start clock fixture failure")
                : new IllegalArgumentException("completion clock fixture failure");
        reporting.throwOnReport = true;
        try {
            try (var observation = syncOperations.execution(claim)) {
                if (phase.equals("start")) metricClock.failure.set(cause);
                ExternalOperationExecution.externalCall("model");
                metricClock.failure.set(phase.equals("complete") ? cause : null);
                syncOperations.complete(claim, JsonNodeFactory.instance.objectNode().put("saved", true));
            }
            assertThat(operation(operation).get("status")).isEqualTo("succeeded");
            assertThat(successes.count()).isEqualTo(before + 1);
            org.awaitility.Awaitility.await().atMost(Duration.ofSeconds(3)).untilAsserted(() -> {
                assertThat(reporting.at("ExternalOperationMetrics.executionTime"))
                        .anySatisfy(report -> {
                            assertThat(report.cause()).isSameAs(cause);
                            assertThat(report.tags()).containsEntry("failure_kind", "unexpected");
                        });
            });
        } finally {
            metricClock.failure.remove();
            reporting.throwOnReport = false;
        }
    }

    @Test
    void committedFailureIsRecordedEvenWhenAnotherTransactionResumesBeforeObservation() {
        UUID user = insertUser();
        UUID session = insertSession(user, insertFinalizedUpload(user), "analyzing", NOW);
        UUID operation = insertOperation(user, session, "analyze", "pending", NOW);
        UUID lease = UUID.randomUUID();
        claimer.claimById(operation, lease, Duration.ofMinutes(5), NOW);
        var failures = meters.get("acttub.external.operations.terminal").tags(
                "kind", "analyze", "outcome", "failed", "classification", "external").counter();
        double before = failures.count();
        try (var executor = Executors.newSingleThreadExecutor()) {
            // Install this at the real first SQL statement, before the observation callback.
            // Commit releases the row lock; another thread then resumes through the real Port.
            TransitionInspector.AFTER_COMMIT.set(() -> {
                try {
                    assertThat(executor.submit(() -> practices.resumeFailedOperation(user, operation,
                            NOW.plusSeconds(1).atOffset(ZoneOffset.UTC))).get(3, TimeUnit.SECONDS)).isTrue();
                } catch (Exception failure) {
                    throw new AssertionError("concurrent resume failed", failure);
                }
            });
            try {
                assertThat(claimer.fail(operation, lease, "fixture_external_failure", true, "external", NOW)).isTrue();
            } finally {
                TransitionInspector.AFTER_COMMIT.remove();
            }
        }
        assertThat(operation(operation).get("status")).isEqualTo("pending");
        assertThat(failures.count()).isEqualTo(before + 1);
    }

    @Test
    void unrepresentableHistoricalDurationReportsAfterCommitWithoutLosingSuccess() {
        UUID user = insertUser();
        UUID session = insertSession(user, insertFinalizedUpload(user), "analyzing", NOW);
        UUID operation = insertOperation(user, session, "coach_start", "pending", NOW);
        UUID lease = UUID.randomUUID();
        claimer.claimById(operation, lease, Duration.ofMinutes(5), NOW);
        jdbc.update("UPDATE external_operations SET created_at=? WHERE id=?",
                Instant.parse("1500-01-01T00:00:00Z").atOffset(ZoneOffset.UTC), operation);
        var successes = meters.get("acttub.external.operations.terminal").tags(
                "kind", "coach_start", "outcome", "succeeded", "classification", "none").counter();
        double before = successes.count();
        reporting.throwOnReport = true;
        try {
            syncOperations.complete(new SyncOperationClaim(operation, lease, UUID.randomUUID()),
                    JsonNodeFactory.instance.objectNode().put("saved", true));
            assertThat(operation(operation).get("status")).isEqualTo("succeeded");
            assertThat(successes.count()).isEqualTo(before + 1);
            org.awaitility.Awaitility.await().atMost(Duration.ofSeconds(3)).untilAsserted(() ->
                    assertThat(reporting.at("ExternalOperationMetrics.afterCommit")).anySatisfy(report -> {
                        assertThat(report.cause()).isInstanceOf(ArithmeticException.class);
                        assertThat(report.tags()).containsEntry("failure_kind", "unexpected");
                    }));
        } finally {
            reporting.throwOnReport = false;
        }
    }

    @Test
    void failedExecutionObservationReportsItsCauseWithoutDelayingOrAbortingTheOperation() {
        UUID user = insertUser();
        UUID session = insertSession(user, insertFinalizedUpload(user), "analyzing", NOW);
        UUID operation = insertOperation(user, session, "coach_start", "pending", NOW);
        UUID lease = UUID.randomUUID();
        claimer.claimById(operation, lease, Duration.ofMinutes(5), NOW);
        var success = meters.get("acttub.external.operations.terminal").tags(
                "kind", "coach_start", "outcome", "succeeded", "classification", "none").counter();
        double before = success.count();
        jdbc.execute("""
                CREATE FUNCTION reject_monitoring_start() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN
                    RAISE EXCEPTION 'monitoring start fixture failure' USING ERRCODE = '57014';
                END $$;
                CREATE TRIGGER reject_monitoring_start BEFORE UPDATE OF execution_started_at ON external_operations
                FOR EACH ROW WHEN (NEW.execution_started_at IS NOT NULL) EXECUTE FUNCTION reject_monitoring_start();
                """);
        reporting.release = new CountDownLatch(1);
        try {
            long began = System.nanoTime();
            try (var observation = syncOperations.execution(new SyncOperationClaim(operation, lease, UUID.randomUUID()))) {
                ExternalOperationExecution.externalCall("model");
                syncOperations.complete(new SyncOperationClaim(operation, lease, UUID.randomUUID()),
                        JsonNodeFactory.instance.objectNode().put("saved", true));
            }
            assertThat(Duration.ofNanos(System.nanoTime() - began)).isLessThan(Duration.ofSeconds(2));
            assertThat(operation(operation).get("status")).isEqualTo("succeeded");
            assertThat(success.count()).isEqualTo(before + 1);
            org.awaitility.Awaitility.await().atMost(Duration.ofSeconds(3)).untilAsserted(() -> {
                var reports = reporting.at("ExternalOperationMetrics.startExecution");
                assertThat(reports).hasSize(1);
                assertThat(reports.getFirst().cause()).hasStackTraceContaining("monitoring start fixture failure");
                assertThat(reports.getFirst().tags()).containsEntry("failure_kind", "external");
            });
        } finally {
            reporting.release.countDown();
            jdbc.execute("DROP TRIGGER reject_monitoring_start ON external_operations");
            jdbc.execute("DROP FUNCTION reject_monitoring_start()");
        }
    }

    @Test
    void previousApplicationSqlInvalidatesStaleTimesWithoutReplayingHistoricalFailures() {
        UUID user = insertUser();
        UUID session = insertSession(user, insertFinalizedUpload(user), "analyzing", NOW);
        UUID pending = insertOperation(user, session, "analyze", "pending", NOW.minusSeconds(500));
        UUID running = insertOperation(user, session, "analyze", "running", NOW.minusSeconds(500));
        jdbc.update("""
                UPDATE external_operations SET attempt_count=1, waiting_since=?, execution_started_at=?,
                    monitoring_updated_at=updated_at, monitoring_lease_token=lease_token WHERE id IN (?,?)
                """, NOW.atOffset(ZoneOffset.UTC), NOW.atOffset(ZoneOffset.UTC), pending, running);
        // The previous application knows only these original columns; stale metadata must not become ages.
        jdbc.update("UPDATE external_operations SET updated_at=? WHERE id=?",
                Instant.now().atOffset(ZoneOffset.UTC), pending);
        jdbc.update("UPDATE external_operations SET updated_at=?, lease_token=?, lease_expires_at=? WHERE id=?",
                Instant.now().atOffset(ZoneOffset.UTC), UUID.randomUUID(),
                Instant.now().plusSeconds(300).atOffset(ZoneOffset.UTC), running);
        double terminals = meters.find("acttub.external.operations.terminal").counters().stream()
                .mapToDouble(io.micrometer.core.instrument.Counter::count).sum();
        org.awaitility.Awaitility.await().atMost(Duration.ofSeconds(3)).untilAsserted(() -> {
            assertThat(meters.get("acttub.external.operations.unmeasured").tags(
                    "kind", "analyze", "state", "pending", "waiting", "retry").gauge().value()).isEqualTo(1);
            assertThat(meters.get("acttub.external.operations.unmeasured").tags(
                    "kind", "analyze", "state", "running", "waiting", "none").gauge().value()).isEqualTo(1);
            assertThat(meters.get("acttub.external.operations.oldest.wait.seconds").tags(
                    "kind", "analyze", "waiting", "retry").gauge().value()).isZero();
            assertThat(meters.get("acttub.external.operations.oldest.running.age.seconds")
                    .tag("kind", "analyze").gauge().value()).isZero();
            assertThat(meters.get("acttub.external.operations.oldest.unfinished.age.seconds")
                    .tag("kind", "analyze").gauge().value()).isGreaterThan(500);
        });
        assertThat(meters.find("acttub.external.operations.terminal").counters().stream()
                .mapToDouble(io.micrometer.core.instrument.Counter::count).sum()).isEqualTo(terminals);
    }

    @Test
    void failedSnapshotKeepsItsLastTimestampUntilDatabaseReadsRecover() throws Exception {
        org.awaitility.Awaitility.await().atMost(Duration.ofSeconds(3)).untilAsserted(() ->
                assertThat(meters.get("acttub.external.operations.snapshot.success").gauge().value()).isEqualTo(1));
        double before;
        try (Connection connection = dataSource.getConnection()) {
            connection.setAutoCommit(false);
            try (Statement statement = connection.createStatement()) {
                statement.execute("LOCK TABLE external_operations IN ACCESS EXCLUSIVE MODE");
                // Wait for one scheduled refresh to time out at the actual PostgreSQL boundary.
                org.awaitility.Awaitility.await().atMost(Duration.ofSeconds(5)).untilAsserted(() ->
                        assertThat(meters.get("acttub.external.operations.snapshot.success").gauge().value()).isZero());
                before = meters.get("acttub.external.operations.snapshot.timestamp.seconds").gauge().value();
                org.awaitility.Awaitility.await().atMost(Duration.ofSeconds(3)).untilAsserted(() -> {
                    var reports = reporting.at("ExternalOperationMetrics.snapshot");
                    assertThat(reports).isNotEmpty();
                    assertThat(reports.getFirst().tags()).containsEntry("failure_kind", "external");
                    assertThat(com.acttub.actingapi.platform.observability.FailureClassifier.classify(
                            reports.getFirst().cause())).isEqualTo(
                                    com.acttub.actingapi.platform.observability.FailureKind.EXTERNAL);
                });
            } finally {
                connection.rollback();
            }
        }
        org.awaitility.Awaitility.await().atMost(Duration.ofSeconds(3)).untilAsserted(() -> {
            assertThat(meters.get("acttub.external.operations.snapshot.success").gauge().value()).isEqualTo(1);
            assertThat(meters.get("acttub.external.operations.snapshot.timestamp.seconds").gauge().value()).isGreaterThan(before);
        });
    }

    @Test
    void resumedOperationHasANewWaitAndTerminalEventButIsNotANewUniqueOperation() {
        var accepted = meters.get("acttub.external.operations.accepted").tag("kind", "analyze").counter();
        var failed = meters.get("acttub.external.operations.terminal").tags(
                "kind", "analyze", "outcome", "failed", "classification", "external").counter();
        var succeeded = meters.get("acttub.external.operations.terminal").tags(
                "kind", "analyze", "outcome", "succeeded", "classification", "none").counter();
        double acceptedBefore = accepted.count(), failedBefore = failed.count(), successBefore = succeeded.count();
        UUID user = insertUser();
        var created = create(user, insertFinalizedUpload(user), UUID.randomUUID(), FINGERPRINT);
        UUID operation = created.operation().id();
        UUID lease = UUID.randomUUID();
        claimer.claimNext("analyze", lease, Duration.ofMinutes(5), Instant.now());
        claimer.fail(operation, lease, "gemini_timeout", true, "external", Instant.now());
        assertThat(failed.count()).isEqualTo(failedBefore + 1);
        assertThatThrownBy(() -> claimer.fail(operation, lease, "duplicate", true, "unexpected", Instant.now()))
                .isInstanceOf(LeaseOwnershipException.class);
        assertThat(practices.resumeFailedOperation(user, operation, Instant.now().atOffset(ZoneOffset.UTC))).isTrue();
        org.awaitility.Awaitility.await().atMost(Duration.ofSeconds(3)).untilAsserted(() -> {
            assertThat(meters.get("acttub.external.operations.current").tags(
                    "kind", "analyze", "state", "pending", "waiting", "retry").gauge().value()).isEqualTo(1);
            assertThat(meters.get("acttub.external.operations.unmeasured").tags(
                    "kind", "analyze", "state", "pending", "waiting", "retry").gauge().value()).isZero();
        });
        UUID nextLease = UUID.randomUUID();
        assertThat(claimer.claimNext("analyze", nextLease, Duration.ofMinutes(5), Instant.now())).isEqualTo(operation);
        var pack = new com.acttub.actingapi.integration.observation.ObservationPack("scene",
                java.util.List.of(new com.acttub.actingapi.integration.observation.ObservationItem(
                        0, 500, "pause", "line", "breath", 0.8)), java.util.List.of());
        analyses.complete(operation, nextLease,
                new com.acttub.actingapi.feature.analysis.app.AnalysisResult(pack, false, 500), "fixture", Instant.now());
        assertThat(accepted.count()).isEqualTo(acceptedBefore + 1);
        assertThat(failed.count()).isEqualTo(failedBefore + 1);
        assertThat(succeeded.count()).isEqualTo(successBefore + 1);
        assertThat(meters.get("acttub.external.operations.wait").tags(
                "kind", "analyze", "waiting", "retry").timer().count()).isGreaterThan(0);
    }

    @Test
    void sweepCountsOnlyNewTerminalFailuresAndNeverOldFailedHistory() {
        var unknown = meters.find("acttub.external.operations.terminal").tags(
                "kind", "analyze", "outcome", "failed", "classification", "unclassified").counter();
        var external = meters.find("acttub.external.operations.terminal").tags(
                "kind", "analyze", "outcome", "failed", "classification", "external").counter();
        assertThat(unknown).isNotNull();
        double before = unknown.count();
        double externalBefore = external.count();
        UUID user = insertUser();
        UUID session = insertSession(user, insertFinalizedUpload(user), "analyzing", NOW);
        UUID old = insertOperation(user, session, "analyze", "failed", NOW.minusSeconds(100));
        UUID pending = insertOperation(user, session, "analyze", "pending", NOW.minusSeconds(90));
        jdbc.update("UPDATE external_operations SET attempt_count=3 WHERE id IN (?,?)", old, pending);
        jdbc.update("UPDATE external_operations SET last_failure_classification='external' WHERE id=?", old);

        assertThat(claimer.sweepMaxAttempts(NOW)).isEqualTo(2);
        assertThat(unknown.count()).isEqualTo(before + 1);
        assertThat(external.count()).isEqualTo(externalBefore);
        assertThat(claimer.sweepMaxAttempts(NOW.plusSeconds(1))).isZero();
        assertThat(unknown.count()).isEqualTo(before + 1);
    }

    @Test
    void newAcceptedOperationsAreCountedOnceAndFailedCreationDoesNotCount() {
        var counter = meters.find("acttub.external.operations.accepted").tag("kind", "analyze").counter();
        assertThat(counter).as("zero counter exists before the first request").isNotNull();
        double before = counter.count();
        UUID user = insertUser();
        UUID upload = insertFinalizedUpload(user);
        UUID request = UUID.randomUUID();
        create(user, upload, request, FINGERPRINT);
        create(user, upload, request, FINGERPRINT);
        assertThat(counter.count()).isEqualTo(before + 1);
        assertThat(create(user, UUID.randomUUID(), UUID.randomUUID(), FINGERPRINT)).isNull();
        UUID failedSession = insertSession(user, upload, "failed", NOW);
        installFailingSessionUpdateTrigger(failedSession);
        assertThatThrownBy(() -> store.createAnalysisRetry(user, failedSession, UUID.randomUUID(), FINGERPRINT, NOW))
                .isInstanceOf(DataAccessException.class);
        assertThat(counter.count()).isEqualTo(before + 1);
    }

    @Test
    void previousSqlCanLeaveFailureClassificationEmptyAndOnlyKnownClassificationsAreStored() {
        UUID user = insertUser();
        UUID session = insertSession(user, insertFinalizedUpload(user), "analyzing", NOW);
        UUID operation = insertOperation(user, session, "analyze", "pending", NOW);
        assertThat(jdbc.queryForObject("SELECT last_failure_classification FROM external_operations WHERE id=?",
                String.class, operation)).isNull();
        for (String classification : new String[] {"expected", "external", "unexpected"}) {
            jdbc.update("UPDATE external_operations SET last_failure_classification=? WHERE id=?",
                    classification, operation);
        }
        assertThatThrownBy(() -> jdbc.update(
                "UPDATE external_operations SET last_failure_classification='unclassified' WHERE id=?", operation))
                .isInstanceOf(DataAccessException.class);
        claimer.claimNext("analyze", UUID.randomUUID(), Duration.ofMinutes(5), NOW);
        assertThat(jdbc.queryForObject("SELECT last_failure_classification FROM external_operations WHERE id=?",
                String.class, operation)).isEqualTo("unexpected");
    }

    @Test
    void analyzeClaimTransitionsOperationAndPracticeSessionTogether() {
        UUID userId = insertUser();
        UUID sessionId = insertSession(userId, insertFinalizedUpload(userId), "failed", NOW.minusSeconds(30));
        UUID operationId = insertOperation(userId, sessionId, "analyze", "pending", NOW.minusSeconds(10));
        UUID leaseToken = UUID.randomUUID();

        UUID claimed = claimer.claimNext("analyze", leaseToken, Duration.ofMinutes(5), NOW);

        assertThat(claimed).isEqualTo(operationId);
        Map<String, Object> operation = operation(operationId);
        assertThat(operation.get("status")).isEqualTo("running");
        assertThat(operation.get("attempt_count")).isEqualTo(1);
        assertThat(operation.get("lease_token")).isEqualTo(leaseToken);
        assertThat(operationUpdatedAt(operationId)).isEqualTo(NOW.atOffset(ZoneOffset.UTC));

        Map<String, Object> session = session(sessionId);
        assertThat(session.get("status")).isEqualTo("analyzing");
        assertThat(sessionUpdatedAt(sessionId)).isEqualTo(NOW.atOffset(ZoneOffset.UTC));
    }

    @Test
    void analyzeClaimRollsBackOperationWhenPracticeSessionUpdateFails() {
        UUID userId = insertUser();
        UUID sessionId = insertSession(userId, insertFinalizedUpload(userId), "failed", NOW.minusSeconds(30));
        UUID operationId = insertOperation(userId, sessionId, "analyze", "pending", NOW.minusSeconds(10));
        installFailingSessionUpdateTrigger(sessionId);

        assertThatThrownBy(() -> claimer.claimNext(
                "analyze", UUID.randomUUID(), Duration.ofMinutes(5), NOW))
                .isInstanceOf(DataAccessException.class);

        Map<String, Object> operation = operation(operationId);
        assertThat(operation.get("status")).isEqualTo("pending");
        assertThat(operation.get("attempt_count")).isEqualTo(0);
        assertThat(operation.get("lease_token")).isNull();
        assertThat(session(sessionId).get("status")).isEqualTo("failed");
    }

    @Test
    void reportAndCoachClaimsDoNotTouchPracticeSession() {
        UUID userId = insertUser();
        for (String kind : new String[] {"report", "coach_start", "coach_reply"}) {
            Instant originalUpdatedAt = NOW.minusSeconds(60);
            UUID sessionId = insertSession(
                    userId, insertFinalizedUpload(userId), "failed", originalUpdatedAt);
            UUID operationId = insertOperation(
                    userId, sessionId, kind, "pending", NOW.minusSeconds(10));

            assertThat(claimer.claimNext(
                    kind, UUID.randomUUID(), Duration.ofMinutes(5), NOW))
                    .isEqualTo(operationId);
            assertThat(session(sessionId).get("status")).isEqualTo("failed");
            assertThat(sessionUpdatedAt(sessionId))
                    .isEqualTo(originalUpdatedAt.atOffset(ZoneOffset.UTC));
        }
    }

    @Test
    void claimByIdReclaimsFailedOperationWhileClaimNextSkipsItAndUsesSeparateLeaseDurations() {
        UUID userId = insertUser();
        UUID failedSessionId = insertSession(
                userId, insertFinalizedUpload(userId), "failed", NOW.minusSeconds(30));
        UUID failedOperationId = insertOperation(
                userId, failedSessionId, "analyze", "failed", NOW.minusSeconds(20));
        jdbc.update("""
                UPDATE external_operations
                SET error_code = 'gemini_timeout',
                    response_payload = '{"stale":true}'::jsonb
                WHERE id = ?
                """, failedOperationId);

        assertThat(claimer.claimNext(
                "analyze", UUID.randomUUID(), Duration.ofSeconds(1800), NOW))
                .as("worker claim-next must not immediately reclaim failed work")
                .isNull();

        UUID syncLeaseToken = UUID.randomUUID();
        assertThat(claimer.claimById(
                failedOperationId, syncLeaseToken, Duration.ofMinutes(15), NOW))
                .isEqualTo(failedOperationId);
        Map<String, Object> syncOperation = operation(failedOperationId);
        assertThat(syncOperation.get("status")).isEqualTo("running");
        assertThat(syncOperation.get("attempt_count")).isEqualTo(1);
        assertThat(syncOperation.get("lease_token")).isEqualTo(syncLeaseToken);
        assertThat(syncOperation.get("error_code")).isNull();
        assertThat(syncOperation.get("response_payload")).isEqualTo("null");
        assertThat(operationLeaseExpiresAt(failedOperationId))
                .isEqualTo(NOW.plus(Duration.ofMinutes(15)).atOffset(ZoneOffset.UTC));
        assertThat(operationUpdatedAt(failedOperationId))
                .isEqualTo(NOW.atOffset(ZoneOffset.UTC));

        UUID workerSessionId = insertSession(
                userId, insertFinalizedUpload(userId), "failed", NOW.minusSeconds(10));
        UUID workerOperationId = insertOperation(
                userId, workerSessionId, "analyze", "pending", NOW.minusSeconds(5));
        UUID workerLeaseToken = UUID.randomUUID();
        assertThat(claimer.claimNext(
                "analyze", workerLeaseToken, Duration.ofSeconds(1800), NOW))
                .isEqualTo(workerOperationId);
        assertThat(operationLeaseExpiresAt(workerOperationId))
                .isEqualTo(NOW.plusSeconds(1800).atOffset(ZoneOffset.UTC));
    }

    @Test
    void failReturnsFalseWhenOperationDoesNotExist() {
        assertThat(claimer.fail(
                UUID.randomUUID(),
                UUID.randomUUID(),
                "gemini_timeout",
                true,
                NOW))
                .isFalse();
    }

    @Test
    void releaseClearsLeaseAndFailurePayloadWithoutRefundingAttempt() {
        UUID userId = insertUser();
        UUID sessionId = insertSession(
                userId, insertFinalizedUpload(userId), "failed", NOW.minusSeconds(30));
        UUID operationId = insertOperation(
                userId, sessionId, "analyze", "pending", NOW.minusSeconds(10));
        UUID leaseToken = UUID.randomUUID();
        assertThat(claimer.claimNext(
                "analyze", leaseToken, Duration.ofSeconds(1800), NOW))
                .isEqualTo(operationId);
        jdbc.update("""
                UPDATE external_operations
                SET error_code = 'transient', response_payload = '{"stale":true}'::jsonb
                WHERE id = ?
                """, operationId);

        assertThat(claimer.release(operationId, leaseToken, NOW.plusSeconds(1))).isTrue();

        Map<String, Object> released = operation(operationId);
        assertThat(released.get("status")).isEqualTo("pending");
        assertThat(released.get("attempt_count")).isEqualTo(1);
        assertThat(released.get("response_payload")).isEqualTo("null");
        assertThat(released.get("error_code")).isNull();
        assertThat(released.get("lease_token")).isNull();
        assertThat(released.get("lease_expires_at")).isNull();
    }

    @Test
    void releaseRejectsALeaseTokenThatIsNotOwned() {
        UUID userId = insertUser();
        UUID sessionId = insertSession(
                userId, insertFinalizedUpload(userId), "failed", NOW.minusSeconds(30));
        UUID operationId = insertOperation(
                userId, sessionId, "analyze", "pending", NOW.minusSeconds(10));
        UUID leaseToken = UUID.randomUUID();
        assertThat(claimer.claimNext(
                "analyze", leaseToken, Duration.ofSeconds(1800), NOW))
                .isEqualTo(operationId);

        assertThatThrownBy(() -> claimer.release(
                operationId, UUID.randomUUID(), NOW.plusSeconds(1)))
                .isInstanceOf(LeaseOwnershipException.class);

        Map<String, Object> operation = operation(operationId);
        assertThat(operation.get("status")).isEqualTo("running");
        assertThat(operation.get("attempt_count")).isEqualTo(1);
        assertThat(operation.get("lease_token")).isEqualTo(leaseToken);
    }

    @ParameterizedTest
    @ValueSource(strings = {"gemini_timeout", "gemini_parse_error", "unsupported_media"})
    void terminalAnalysisErrorsImmediatelyFailOperationAndSession(String errorCode) {
        UUID userId = insertUser();
        UUID sessionId = insertSession(
                userId, insertFinalizedUpload(userId), "failed", NOW.minusSeconds(30));
        UUID operationId = insertOperation(
                userId, sessionId, "analyze", "pending", NOW.minusSeconds(10));
        UUID leaseToken = UUID.randomUUID();
        assertThat(claimer.claimNext(
                "analyze", leaseToken, Duration.ofSeconds(1800), NOW))
                .isEqualTo(operationId);

        assertThat(claimer.fail(
                operationId, leaseToken, errorCode, true, NOW.plusSeconds(1)))
                .isTrue();

        Map<String, Object> failed = operation(operationId);
        assertThat(failed.get("status")).isEqualTo("failed");
        assertThat(failed.get("error_code")).isEqualTo(errorCode);
        assertThat(failed.get("response_payload")).isEqualTo("null");
        assertThat(failed.get("lease_token")).isNull();
        assertThat(failed.get("lease_expires_at")).isNull();
        assertThat(session(sessionId).get("status")).isEqualTo("failed");
    }

    @Test
    void transientErrorsConsumeThreeAttemptsBeforeIdempotentSweepFailsOperationAndSession() {
        UUID userId = insertUser();
        UUID sessionId = insertSession(
                userId, insertFinalizedUpload(userId), "failed", NOW.minusSeconds(30));
        UUID operationId = insertOperation(
                userId, sessionId, "analyze", "pending", NOW.minusSeconds(10));

        for (int attempt = 1; attempt <= ExternalOperationClaimer.MAX_EXTERNAL_OPERATION_ATTEMPTS;
                attempt++) {
            Instant attemptAt = NOW.plusSeconds(attempt);
            UUID leaseToken = UUID.randomUUID();
            assertThat(claimer.claimNext(
                    "analyze", leaseToken, Duration.ofSeconds(1800), attemptAt))
                    .isEqualTo(operationId);
            assertThat(claimer.release(operationId, leaseToken, attemptAt.plusMillis(1)))
                    .isTrue();
            assertThat(operation(operationId).get("attempt_count")).isEqualTo(attempt);
        }
        assertThat(claimer.claimNext(
                "analyze", UUID.randomUUID(), Duration.ofSeconds(1800), NOW.plusSeconds(10)))
                .isNull();

        assertThat(claimer.sweepMaxAttempts(NOW.plusSeconds(11))).isEqualTo(1);
        Map<String, Object> swept = operation(operationId);
        assertThat(swept.get("status")).isEqualTo("failed");
        assertThat(swept.get("attempt_count"))
                .isEqualTo(ExternalOperationClaimer.MAX_EXTERNAL_OPERATION_ATTEMPTS);
        assertThat(swept.get("error_code")).isEqualTo("max_attempts_exceeded");
        assertThat(swept.get("response_payload")).isEqualTo("null");
        assertThat(session(sessionId).get("status")).isEqualTo("failed");
        assertThat(claimer.sweepMaxAttempts(NOW.plusSeconds(12)))
                .as("max_attempts_exceeded makes the sweep idempotent")
                .isZero();
    }

    @Test
    void failedLeaseOwnershipRollsBackSessionTransition() {
        double before = meters.find("acttub.external.operations.terminal").counters().stream()
                .mapToDouble(io.micrometer.core.instrument.Counter::count).sum();
        UUID userId = insertUser();
        UUID sessionId = insertSession(
                userId, insertFinalizedUpload(userId), "failed", NOW.minusSeconds(30));
        UUID operationId = insertOperation(
                userId, sessionId, "analyze", "pending", NOW.minusSeconds(10));
        UUID oldLeaseToken = UUID.randomUUID();
        assertThat(claimer.claimNext(
                "analyze", oldLeaseToken, Duration.ofSeconds(1), NOW))
                .isEqualTo(operationId);
        UUID newLeaseToken = UUID.randomUUID();
        assertThat(claimer.claimById(
                operationId, newLeaseToken, Duration.ofMinutes(15), NOW.plusSeconds(2)))
                .isEqualTo(operationId);

        assertThatThrownBy(() -> claimer.fail(
                operationId,
                oldLeaseToken,
                "gemini_timeout",
                true,
                "external",
                NOW.plusSeconds(3)))
                .isInstanceOf(LeaseOwnershipException.class);

        Map<String, Object> operation = operation(operationId);
        assertThat(operation.get("status")).isEqualTo("running");
        assertThat(operation.get("lease_token")).isEqualTo(newLeaseToken);
        assertThat(session(sessionId).get("status"))
                .as("session failure must roll back when operation lease ownership was lost")
                .isEqualTo("analyzing");
        assertThat(jdbc.queryForObject("SELECT last_failure_classification FROM external_operations WHERE id=?",
                String.class, operationId)).isNull();
        assertThat(meters.find("acttub.external.operations.terminal").counters().stream()
                .mapToDouble(io.micrometer.core.instrument.Counter::count).sum()).isEqualTo(before);
    }

    @Test
    void practiceCreationCreatesSessionAndOperation() {
        UUID userId = insertUser();
        UUID uploadId = insertFinalizedUpload(userId);

        PracticeSessionOperation result = create(userId, uploadId, UUID.randomUUID(), FINGERPRINT);

        assertThat(result).isNotNull();
        assertThat(result.created()).isTrue();
        assertThat(result.fingerprintMismatch()).isFalse();
        assertThat(result.session().status()).isEqualTo("analyzing");
        assertThat(result.session().uploadIntentId()).isEqualTo(uploadId);
        assertThat(result.operation().sessionId()).isEqualTo(result.session().id());
        assertThat(result.operation().kind()).isEqualTo("analyze");
        assertThat(result.operation().status()).isEqualTo("pending");
    }

    @Test
    void practiceCreationReplayReturnsExistingPairWithoutSecondSessionAndDetectsFingerprintMismatch() {
        UUID userId = insertUser();
        UUID uploadId = insertFinalizedUpload(userId);
        UUID requestId = UUID.randomUUID();
        PracticeSessionOperation created = create(userId, uploadId, requestId, FINGERPRINT);

        PracticeSessionOperation replay = create(userId, uploadId, requestId, FINGERPRINT);
        PracticeSessionOperation mismatch = create(
                userId, uploadId, requestId, OTHER_FINGERPRINT);

        assertThat(replay.created()).isFalse();
        assertThat(replay.session().id()).isEqualTo(created.session().id());
        assertThat(replay.operation().id()).isEqualTo(created.operation().id());
        assertThat(replay.fingerprintMismatch()).isFalse();
        assertThat(mismatch.fingerprintMismatch()).isTrue();
        assertThat(sessionCount(userId)).isEqualTo(1);
    }

    @Test
    void concurrentPracticeCreationDeletesTheLosingNewSession() throws Exception {
        UUID userId = insertUser();
        UUID losingUploadId = insertFinalizedUpload(userId);
        UUID winningUploadId = insertFinalizedUpload(userId);
        UUID requestId = UUID.randomUUID();
        installBlockingSessionInsertTrigger(losingUploadId, CREATION_LOCK);

        try (Connection blocker = dataSource.getConnection()) {
            advisoryLock(blocker, CREATION_LOCK);
            ExecutorService executor = Executors.newSingleThreadExecutor();
            try {
                Future<PracticeSessionOperation> loser = executor.submit(
                        () -> create(userId, losingUploadId, requestId, FINGERPRINT));
                awaitBlockedQuery("insert into practice_sessions");

                PracticeSessionOperation winner = create(
                        userId, winningUploadId, requestId, FINGERPRINT);
                advisoryUnlock(blocker, CREATION_LOCK);
                PracticeSessionOperation replay = loser.get(5, TimeUnit.SECONDS);

                assertThat(winner.created()).isTrue();
                assertThat(replay.created()).isFalse();
                assertThat(replay.session().id()).isEqualTo(winner.session().id());
                assertThat(replay.operation().id()).isEqualTo(winner.operation().id());
                assertThat(sessionCount(userId))
                        .as("충돌에서 패배한 트랜잭션이 먼저 만든 세션을 삭제해야 한다")
                        .isEqualTo(1);
            } finally {
                advisoryUnlock(blocker, CREATION_LOCK);
                executor.shutdownNow();
                executor.awaitTermination(5, TimeUnit.SECONDS);
            }
        }
    }

    @Test
    void retryConflictKeepsLosingSessionFailedAndReplaysWinningOperation() throws Exception {
        UUID userId = insertUser();
        UUID losingSessionId = insertSession(
                userId, insertFinalizedUpload(userId), "failed", NOW.minusSeconds(60));
        UUID winningSessionId = insertSession(
                userId, insertFinalizedUpload(userId), "failed", NOW.minusSeconds(50));
        UUID requestId = UUID.randomUUID();
        installBlockingOperationInsertTrigger(losingSessionId, RETRY_LOCK);

        try (Connection blocker = dataSource.getConnection()) {
            advisoryLock(blocker, RETRY_LOCK);
            ExecutorService executor = Executors.newSingleThreadExecutor();
            try {
                Future<PracticeSessionOperation> loser = executor.submit(() ->
                        store.createAnalysisRetry(
                                userId, losingSessionId, requestId, FINGERPRINT, NOW));
                awaitBlockedQuery("INSERT INTO external_operations");

                PracticeSessionOperation winner = store.createAnalysisRetry(
                        userId, winningSessionId, requestId, FINGERPRINT, NOW);
                advisoryUnlock(blocker, RETRY_LOCK);
                PracticeSessionOperation replay = loser.get(5, TimeUnit.SECONDS);

                assertThat(winner.created()).isTrue();
                assertThat(winner.session().status()).isEqualTo("analyzing");
                assertThat(replay.created()).isFalse();
                assertThat(replay.operation().id()).isEqualTo(winner.operation().id());
                assertThat(replay.session().id()).isEqualTo(winningSessionId);
                assertThat(replay.fingerprintMismatch())
                        .as("retry mismatch는 요청 fingerprint뿐 아니라 session_id도 비교한다")
                        .isTrue();
                assertThat(session(losingSessionId).get("status")).isEqualTo("failed");
                assertThat(sessionUpdatedAt(losingSessionId))
                        .isEqualTo(NOW.minusSeconds(60).atOffset(ZoneOffset.UTC));
                assertThat(operationCount(userId, requestId)).isEqualTo(1);
            } finally {
                advisoryUnlock(blocker, RETRY_LOCK);
                executor.shutdownNow();
                executor.awaitTermination(5, TimeUnit.SECONDS);
            }
        }
    }

    @Test
    void retryReplayIsResolvedBeforeNonFailedStatusCheck() {
        UUID userId = insertUser();
        UUID sessionId = insertSession(
                userId, insertFinalizedUpload(userId), "failed", NOW.minusSeconds(30));
        UUID requestId = UUID.randomUUID();
        PracticeSessionOperation created = store.createAnalysisRetry(
                userId, sessionId, requestId, FINGERPRINT, NOW);
        jdbc.update("""
                UPDATE practice_sessions
                SET status = 'analyzed'
                WHERE id = ?
                """, sessionId);

        PracticeSessionOperation replay = store.createAnalysisRetry(
                userId, sessionId, requestId, FINGERPRINT, NOW.plusSeconds(1));

        assertThat(created.created()).isTrue();
        assertThat(replay).isNotNull();
        assertThat(replay.created()).isFalse();
        assertThat(replay.operation().id()).isEqualTo(created.operation().id());
        assertThat(replay.session().status()).isEqualTo("analyzed");
        assertThat(replay.fingerprintMismatch()).isFalse();
    }

    @Test
    void concurrentSyncBeginsCreateOneOperationAndOnlyOneOwnsTheLease() throws Exception {
        UUID userId = insertUser();
        UUID sessionId = insertSession(
                userId, insertFinalizedUpload(userId), "analyzed", NOW.minusSeconds(30));
        UUID requestId = UUID.randomUUID();
        CountDownLatch start = new CountDownLatch(1);
        ExecutorService executor = Executors.newFixedThreadPool(2);
        try {
            var work = (java.util.concurrent.Callable<BeginOutcome>) () -> {
                start.await();
                try {
                    return new BeginOutcome(syncOperations.begin(
                            userId, sessionId, requestId, "coach_start", FINGERPRINT), null);
                } catch (ApiException exception) {
                    return new BeginOutcome(null, exception);
                }
            };
            Future<BeginOutcome> first = executor.submit(work);
            Future<BeginOutcome> second = executor.submit(work);
            start.countDown();
            BeginOutcome left = first.get(5, TimeUnit.SECONDS);
            BeginOutcome right = second.get(5, TimeUnit.SECONDS);

            assertThat(java.util.stream.Stream.of(left, right)
                    .filter(outcome -> outcome.begin() != null)
                    .toList())
                    .singleElement()
                    .satisfies(outcome -> assertThat(outcome.begin().claim()).isNotNull());
            assertThat(java.util.stream.Stream.of(left, right)
                    .filter(outcome -> outcome.error() != null)
                    .toList())
                    .singleElement()
                    .satisfies(outcome -> {
                        assertThat(outcome.error().status()).isEqualTo(409);
                        assertThat(outcome.error()).hasMessage("request is still processing");
                    });
            assertThat(operationCount(userId, requestId)).isEqualTo(1);
        } finally {
            executor.shutdownNow();
            executor.awaitTermination(5, TimeUnit.SECONDS);
        }
    }

    @Test
    void completedSyncOperationReplaysAndStillRejectsAFingerprintMismatch() {
        UUID userId = insertUser();
        UUID sessionId = insertSession(
                userId, insertFinalizedUpload(userId), "analyzed", NOW.minusSeconds(30));
        UUID requestId = UUID.randomUUID();
        SyncOperationBegin started = syncOperations.begin(
                userId, sessionId, requestId, "coach_start", FINGERPRINT);
        var payload = JsonNodeFactory.instance.objectNode().put("reply", "저장된 응답");

        syncOperations.complete(started.claim(), payload);

        SyncOperationBegin replay = syncOperations.begin(
                userId, sessionId, requestId, "coach_start", FINGERPRINT);
        assertThat(replay.isReplay()).isTrue();
        assertThat(replay.replayPayload()).isEqualTo(payload);
        assertThatThrownBy(() -> syncOperations.begin(
                userId, sessionId, requestId, "coach_start", OTHER_FINGERPRINT))
                .isInstanceOf(ApiException.class)
                .satisfies(exception -> assertThat(((ApiException) exception).status())
                        .isEqualTo(422))
                .hasMessage("request_fingerprint_mismatch");
    }

    @Test
    void memoryQueueCompletesAndFailsOnlyItsLeaseWithoutChangingThePracticeStatus() {
        UUID userId = insertUser();
        UUID sessionId = insertSession(
                userId, insertFinalizedUpload(userId), "analyzed", NOW.minusSeconds(30));
        UUID operationId = insertOperation(
                userId, sessionId, "memory_update", "pending", NOW.minusSeconds(10));
        UUID leaseToken = UUID.randomUUID();

        assertThat(memoryQueue.claimNext(
                leaseToken, Duration.ofMinutes(5), NOW)).isEqualTo(operationId);
        assertThat(memoryQueue.practiceSessionOf(operationId)).isEqualTo(sessionId);
        assertThatThrownBy(() -> memoryQueue.complete(
                operationId,
                UUID.randomUUID(),
                () -> JsonNodeFactory.instance.objectNode().put("updated", 1),
                NOW.plusSeconds(1)))
                .isInstanceOf(LeaseOwnershipException.class);

        memoryQueue.complete(
                operationId,
                leaseToken,
                () -> JsonNodeFactory.instance.objectNode().put("updated", 1),
                NOW.plusSeconds(2));

        assertThat(operation(operationId))
                .containsEntry("status", "succeeded")
                .containsEntry("response_payload", "{\"updated\": 1}")
                .containsEntry("lease_token", null);
        assertThat(session(sessionId)).containsEntry("status", "analyzed");

        UUID failedOperationId = insertOperation(
                userId, sessionId, "memory_update", "pending", NOW.minusSeconds(5));
        UUID failedLease = UUID.randomUUID();
        assertThat(memoryQueue.claimNext(
                failedLease, Duration.ofMinutes(5), NOW.plusSeconds(3)))
                .isEqualTo(failedOperationId);
        assertThatThrownBy(() -> memoryQueue.fail(
                failedOperationId, UUID.randomUUID(), "gemini_timeout", NOW.plusSeconds(4)))
                .isInstanceOf(LeaseOwnershipException.class);

        memoryQueue.fail(
                failedOperationId, failedLease, "gemini_timeout", NOW.plusSeconds(5));

        assertThat(operation(failedOperationId))
                .containsEntry("status", "failed")
                .containsEntry("error_code", "gemini_timeout")
                .containsEntry("lease_token", null);
        assertThat(session(sessionId)).containsEntry("status", "analyzed");
    }

    private PracticeSessionOperation create(
            UUID userId,
            UUID uploadId,
            UUID requestId,
            String fingerprint) {
        return store.createWithAnalysis(
                userId,
                uploadId,
                "상황",
                "인물",
                "목표",
                "분석",
                "캐릭터 분석",
                null,
                null,
                requestId,
                fingerprint);
    }

    private UUID insertUser() {
        UUID id = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO users (id, email, status)
                VALUES (?, ?, 'active')
                """, id, id + "@example.test");
        return id;
    }

    private UUID insertFinalizedUpload(UUID userId) {
        UUID id = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO upload_intents (
                    id,
                    user_id,
                    status,
                    storage_provider,
                    object_key,
                    mime_type,
                    size_bytes,
                    expires_at
                )
                VALUES (?, ?, 'finalized', 's3', ?, 'video/mp4', 1, ?)
                """,
                id,
                userId,
                "uploads/" + id + ".mp4",
                NOW.plusSeconds(3600).atOffset(ZoneOffset.UTC));
        return id;
    }

    private UUID insertSession(
            UUID userId,
            UUID uploadId,
            String status,
            Instant updatedAt) {
        UUID id = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO practice_sessions (
                    id,
                    user_id,
                    upload_intent_id,
                    status,
                    situation,
                    character_context,
                    blockage_kind,
                    sub_branch,
                    goal,
                    updated_at
                )
                VALUES (?, ?, ?, ?, '상황', '인물', '분석', '캐릭터 분석', '목표', ?)
                """,
                id,
                userId,
                uploadId,
                status,
                updatedAt.atOffset(ZoneOffset.UTC));
        return id;
    }

    private UUID insertOperation(
            UUID userId,
            UUID sessionId,
            String kind,
            String status,
            Instant createdAt) {
        UUID id = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO external_operations (
                    id,
                    session_id,
                    user_id,
                    request_id,
                    kind,
                    status,
                    request_fingerprint,
                    created_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                id,
                sessionId,
                userId,
                UUID.randomUUID(),
                kind,
                status,
                FINGERPRINT,
                createdAt.atOffset(ZoneOffset.UTC));
        return id;
    }

    private Map<String, Object> operation(UUID operationId) {
        return jdbc.queryForMap("""
                SELECT
                    status,
                    attempt_count,
                    lease_token,
                    lease_expires_at,
                    error_code,
                    response_payload::text AS response_payload
                FROM external_operations
                WHERE id = ?
                """, operationId);
    }

    private Map<String, Object> session(UUID sessionId) {
        return jdbc.queryForMap("""
                SELECT status
                FROM practice_sessions
                WHERE id = ?
                """, sessionId);
    }

    private OffsetDateTime operationUpdatedAt(UUID operationId) {
        return jdbc.queryForObject("""
                SELECT updated_at
                FROM external_operations
                WHERE id = ?
                """, OffsetDateTime.class, operationId);
    }

    private OffsetDateTime operationLeaseExpiresAt(UUID operationId) {
        return jdbc.queryForObject("""
                SELECT lease_expires_at
                FROM external_operations
                WHERE id = ?
                """, OffsetDateTime.class, operationId);
    }

    private OffsetDateTime sessionUpdatedAt(UUID sessionId) {
        return jdbc.queryForObject("""
                SELECT updated_at
                FROM practice_sessions
                WHERE id = ?
                """, OffsetDateTime.class, sessionId);
    }

    private long sessionCount(UUID userId) {
        Long count = jdbc.queryForObject(
                "SELECT count(*) FROM practice_sessions WHERE user_id = ?",
                Long.class,
                userId);
        return count == null ? 0L : count;
    }

    private long operationCount(UUID userId, UUID requestId) {
        Long count = jdbc.queryForObject("""
                SELECT count(*)
                FROM external_operations
                WHERE user_id = ? AND request_id = ?
                """, Long.class, userId, requestId);
        return count == null ? 0L : count;
    }

    private void installFailingSessionUpdateTrigger(UUID sessionId) {
        jdbc.execute("""
                CREATE FUNCTION fail_claim_session_update() RETURNS trigger
                LANGUAGE plpgsql AS $$
                BEGIN
                    IF NEW.id = '%s'::uuid THEN
                        RAISE EXCEPTION 'forced session update failure';
                    END IF;
                    RETURN NEW;
                END
                $$
                """.formatted(sessionId));
        jdbc.execute("""
                CREATE TRIGGER fail_claim_session_update
                BEFORE UPDATE ON practice_sessions
                FOR EACH ROW EXECUTE FUNCTION fail_claim_session_update()
                """);
    }

    private void installBlockingSessionInsertTrigger(UUID uploadId, long lockKey) {
        jdbc.execute("""
                CREATE FUNCTION block_creation_session_insert() RETURNS trigger
                LANGUAGE plpgsql AS $$
                BEGIN
                    IF NEW.upload_intent_id = '%s'::uuid THEN
                        PERFORM pg_advisory_lock(%d);
                        PERFORM pg_advisory_unlock(%d);
                    END IF;
                    RETURN NEW;
                END
                $$
                """.formatted(uploadId, lockKey, lockKey));
        jdbc.execute("""
                CREATE TRIGGER block_creation_session_insert
                BEFORE INSERT ON practice_sessions
                FOR EACH ROW EXECUTE FUNCTION block_creation_session_insert()
                """);
    }

    private void installBlockingOperationInsertTrigger(UUID sessionId, long lockKey) {
        jdbc.execute("""
                CREATE FUNCTION block_retry_operation_insert() RETURNS trigger
                LANGUAGE plpgsql AS $$
                BEGIN
                    IF NEW.session_id = '%s'::uuid THEN
                        PERFORM pg_advisory_lock(%d);
                        PERFORM pg_advisory_unlock(%d);
                    END IF;
                    RETURN NEW;
                END
                $$
                """.formatted(sessionId, lockKey, lockKey));
        jdbc.execute("""
                CREATE TRIGGER block_retry_operation_insert
                BEFORE INSERT ON external_operations
                FOR EACH ROW EXECUTE FUNCTION block_retry_operation_insert()
                """);
    }

    private void advisoryLock(Connection connection, long key) throws Exception {
        try (Statement statement = connection.createStatement()) {
            statement.execute("SELECT pg_advisory_lock(" + key + ")");
        }
    }

    private void advisoryUnlock(Connection connection, long key) throws Exception {
        try (Statement statement = connection.createStatement()) {
            statement.execute("SELECT pg_advisory_unlock(" + key + ")");
        }
    }

    private void awaitBlockedQuery(String fragment) throws Exception {
        Instant deadline = Instant.now().plusSeconds(5);
        while (Instant.now().isBefore(deadline)) {
            Integer count = jdbc.queryForObject("""
                    SELECT count(*)
                    FROM pg_stat_activity
                    WHERE datname = current_database()
                      AND wait_event_type = 'Lock'
                      AND query LIKE ?
                    """, Integer.class, "%" + fragment + "%");
            if (count != null && count > 0) {
                return;
            }
            Thread.sleep(10);
        }
        throw new AssertionError("query did not block: " + fragment);
    }

    private record BeginOutcome(SyncOperationBegin begin, ApiException error) {
    }
}
