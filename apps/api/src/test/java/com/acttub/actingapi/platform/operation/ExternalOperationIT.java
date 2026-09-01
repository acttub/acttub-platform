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
import com.acttub.actingapi.feature.practice.app.PracticeSessionLedger;
import com.acttub.actingapi.feature.practice.app.PracticeSessionOperation;
import com.acttub.actingapi.support.PostgresContainerSupport;
import com.acttub.actingapi.platform.web.ApiException;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

@SpringBootTest(properties = "JWT_SECRET=test-secret")
class ExternalOperationIT {

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
    CoachOperationLedger syncOperations;

    @Autowired
    MemoryUpdateQueue memoryQueue;

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
                NOW.plusSeconds(3)))
                .isInstanceOf(LeaseOwnershipException.class);

        Map<String, Object> operation = operation(operationId);
        assertThat(operation.get("status")).isEqualTo("running");
        assertThat(operation.get("lease_token")).isEqualTo(newLeaseToken);
        assertThat(session(sessionId).get("status"))
                .as("session failure must roll back when operation lease ownership was lost")
                .isEqualTo("analyzing");
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
                JsonNodeFactory.instance.objectNode().put("updated", 1),
                NOW.plusSeconds(1)))
                .isInstanceOf(LeaseOwnershipException.class);

        memoryQueue.complete(
                operationId,
                leaseToken,
                JsonNodeFactory.instance.objectNode().put("updated", 1),
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
