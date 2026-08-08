package com.acttub.actingapi.operation;

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
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import javax.sql.DataSource;

import com.acttub.actingapi.support.PostgresContainerSupport;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

@SpringBootTest(properties = "JWT_SECRET=test-secret")
class ExternalOperationStoreIT {

    private static final Instant NOW = Instant.parse("2026-08-08T01:02:03.456789Z");
    private static final String FINGERPRINT = "a".repeat(64);
    private static final String OTHER_FINGERPRINT = "b".repeat(64);
    private static final long CREATION_LOCK = 287001L;
    private static final long RETRY_LOCK = 287002L;

    @DynamicPropertySource
    static void datasource(DynamicPropertyRegistry registry) {
        String database = PostgresContainerSupport.createDatabaseName("external_operation_store_it");
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
    ExternalOperationStore store;

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
                awaitBlockedQuery("INSERT INTO practice_sessions");

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
                        store.createAnalysisRetryOperation(
                                userId, losingSessionId, requestId, FINGERPRINT, NOW));
                awaitBlockedQuery("INSERT INTO external_operations");

                PracticeSessionOperation winner = store.createAnalysisRetryOperation(
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
        PracticeSessionOperation created = store.createAnalysisRetryOperation(
                userId, sessionId, requestId, FINGERPRINT, NOW);
        jdbc.update("""
                UPDATE practice_sessions
                SET status = 'analyzed'::practice_status_t
                WHERE id = ?
                """, sessionId);

        PracticeSessionOperation replay = store.createAnalysisRetryOperation(
                userId, sessionId, requestId, FINGERPRINT, NOW.plusSeconds(1));

        assertThat(created.created()).isTrue();
        assertThat(replay).isNotNull();
        assertThat(replay.created()).isFalse();
        assertThat(replay.operation().id()).isEqualTo(created.operation().id());
        assertThat(replay.session().status()).isEqualTo("analyzed");
        assertThat(replay.fingerprintMismatch()).isFalse();
    }

    private PracticeSessionOperation create(
            UUID userId,
            UUID uploadId,
            UUID requestId,
            String fingerprint) {
        return store.createPracticeSessionWithAnalysisOperation(
                userId,
                uploadId,
                "상황",
                "인물",
                "목표",
                "분석",
                "캐릭터 분석",
                null,
                requestId,
                fingerprint);
    }

    private UUID insertUser() {
        UUID id = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO users (id, email, status)
                VALUES (?, ?, 'active'::user_status_t)
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
                VALUES (?, ?, 'finalized'::upload_status_t, 's3', ?, 'video/mp4', 1, ?)
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
                VALUES (?, ?, ?, ?::practice_status_t, '상황', '인물', '분석', '캐릭터 분석', '목표', ?)
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
                VALUES (?, ?, ?, ?, ?::operation_kind_t, ?::operation_status_t, ?, ?)
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
                    status::text AS status,
                    attempt_count,
                    lease_token
                FROM external_operations
                WHERE id = ?
                """, operationId);
    }

    private Map<String, Object> session(UUID sessionId) {
        return jdbc.queryForMap("""
                SELECT status::text AS status
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
}
