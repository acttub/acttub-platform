package com.acttub.actingapi.feature.memory.app;

import static org.assertj.core.api.Assertions.assertThat;

import java.sql.Connection;
import java.sql.Statement;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.UUID;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import javax.sql.DataSource;

import com.acttub.actingapi.integration.llm.GeneratedText;
import com.acttub.actingapi.integration.llm.TextGenerator;
import com.acttub.actingapi.integration.llm.TokenUsage;
import com.acttub.actingapi.platform.ledger.LeaseOwnershipException;
import com.acttub.actingapi.platform.schema.ActorMemoryField;
import com.acttub.actingapi.support.PostgresContainerSupport;
import com.acttub.actingapi.support.RecordingFailureReporter;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/** 공개 워커와 실제 저장 계약에서 늦은 모델 응답의 Lease 경합을 검증한다. */
@SpringBootTest(properties = "JWT_SECRET=test-secret")
class MemoryUpdateWorkerIT {
    private static final Instant NOW = Instant.parse("2026-09-08T01:02:03Z");

    @DynamicPropertySource
    static void datasource(DynamicPropertyRegistry registry) {
        String database = PostgresContainerSupport.createDatabaseName("memory_worker_it");
        registry.add("spring.datasource.url", () -> PostgresContainerSupport.jdbcUrlFor(database));
        registry.add("spring.datasource.username", PostgresContainerSupport.POSTGRES::getUsername);
        registry.add("spring.datasource.password", PostgresContainerSupport.POSTGRES::getPassword);
    }

    @Autowired JdbcTemplate jdbc;
    @Autowired DataSource dataSource;
    @Autowired MemoryRepository memory;
    @Autowired MemoryUpdateQueue queue;
    @Autowired ObjectMapper mapper;

    private UUID userId;
    private UUID sessionId;
    private UUID operationId;
    private RecordingFailureReporter reporter;

    @BeforeEach
    void prepareOperation() {
        jdbc.execute("TRUNCATE TABLE users RESTART IDENTITY CASCADE");
        userId = UUID.randomUUID();
        sessionId = UUID.randomUUID();
        operationId = UUID.randomUUID();
        UUID uploadId = UUID.randomUUID();
        jdbc.update("INSERT INTO users (id,email,status) VALUES (?,?,'active')",
                userId, userId + "@example.test");
        jdbc.update("""
                INSERT INTO upload_intents
                    (id,user_id,status,storage_provider,object_key,mime_type,size_bytes,expires_at)
                VALUES (?,?,'finalized','s3',?,'video/mp4',1,?)
                """, uploadId, userId, "uploads/" + uploadId, NOW.plusSeconds(3600).atOffset(ZoneOffset.UTC));
        jdbc.update("""
                INSERT INTO practice_sessions
                    (id,user_id,upload_intent_id,status,situation,character_context,blockage_kind,sub_branch,goal)
                VALUES (?,?,?,'analyzed','상황','인물','분석','캐릭터 분석','목표')
                """, sessionId, userId, uploadId);
        jdbc.update("""
                INSERT INTO external_operations
                    (id,session_id,user_id,request_id,kind,request_fingerprint)
                VALUES (?,?,?,?,'memory_update',?)
                """, operationId, sessionId, userId, UUID.randomUUID(), "a".repeat(64));
        reporter = new RecordingFailureReporter();
    }

    @Test
    void reassignedWorkerCannotOverwriteTheNewWorkersMemory() {
        MemoryUpdateWorker newer = worker((system, user) -> generated("새 목표"));
        MemoryUpdateWorker stale = worker((system, user) -> {
            assertThat(TransactionSynchronizationManager.isActualTransactionActive()).isFalse();
            // 첫 모델 응답이 도착하기 전에 Lease가 만료되고 새 워커가 끝나는 순서를 고정한다.
            assertThat(newer.runOnce(NOW.plusSeconds(301))).isTrue();
            return generated("이전 목표");
        });

        assertThat(stale.runOnce(NOW)).isTrue();

        assertThat(memory.list(userId)).containsExactly(
                new MemoryEntry("goal", "새 목표", false, sessionId));
        assertThat(jdbc.queryForMap("SELECT status,attempt_count FROM external_operations WHERE id=?", operationId))
                .containsEntry("status", "succeeded").containsEntry("attempt_count", 2);
        assertThat(reporter.reports()).singleElement().satisfies(report -> {
            assertThat(report.failure()).isInstanceOf(LeaseOwnershipException.class);
            assertThat(report.context()).isEqualTo("MemoryUpdateWorker.complete operation_id=" + operationId);
        });
    }

    @AfterEach
    void removeFailureTriggers() {
        jdbc.execute("DROP TRIGGER IF EXISTS fail_memory_write ON actor_memory_entries");
        jdbc.execute("DROP TRIGGER IF EXISTS fail_memory_complete ON external_operations");
        jdbc.execute("DROP FUNCTION IF EXISTS fail_memory_update()");
        jdbc.execute("DROP TRIGGER IF EXISTS pause_first_memory ON actor_memory_entries");
        jdbc.execute("DROP FUNCTION IF EXISTS pause_first_memory()");
    }

    @ParameterizedTest
    @ValueSource(strings = {"write", "complete"})
    void storageFailureRollsBackAllMemoryAndOnlyFailsTheOptionalOperation(String failurePoint) {
        memory.writeAsAgent(userId, ActorMemoryField.GOAL, "원래 목표", sessionId);
        jdbc.execute("""
                CREATE FUNCTION fail_memory_update() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN RAISE EXCEPTION 'injected memory storage failure'; END $$
                """);
        if ("write".equals(failurePoint)) {
            jdbc.execute("""
                    CREATE TRIGGER fail_memory_write BEFORE INSERT ON actor_memory_entries
                    FOR EACH ROW WHEN (NEW.field = 'blockage') EXECUTE FUNCTION fail_memory_update()
                    """);
        } else {
            jdbc.execute("""
                    CREATE TRIGGER fail_memory_complete BEFORE UPDATE ON external_operations
                    FOR EACH ROW WHEN (NEW.status = 'succeeded') EXECUTE FUNCTION fail_memory_update()
                    """);
        }
        MemoryUpdateWorker worker = worker((system, user) -> new GeneratedText(
                "{\"goal\":\"새 목표\",\"blockage\":\"새 막힘\"}", new TokenUsage(0, 0, 0)));

        assertThat(worker.runOnce(NOW)).isTrue();

        assertThat(memory.list(userId)).containsExactly(
                new MemoryEntry("goal", "원래 목표", false, sessionId));
        assertThat(jdbc.queryForMap("""
                SELECT status,error_code,attempt_count,response_payload::text AS payload,lease_token
                FROM external_operations WHERE id=?
                """, operationId))
                .containsEntry("status", "failed").containsEntry("error_code", "memory_update_failed")
                .containsEntry("attempt_count", 1).containsEntry("payload", "null").containsEntry("lease_token", null);
        assertThat(jdbc.queryForObject("SELECT status FROM practice_sessions WHERE id=?", String.class, sessionId))
                .isEqualTo("analyzed");
        assertThat(reporter.reports()).singleElement().satisfies(report ->
                assertThat(report.context()).isEqualTo("MemoryUpdateWorker.update operation_id=" + operationId));
        // 기존 memory_update 실패 정책: FAILED를 다음 claimNext가 자동으로 재실행하지 않는다.
        assertThat(worker.runOnce(NOW.plusSeconds(1))).isFalse();
    }

    @Test
    void expiredButUnreassignedLeaseCompletesWithTheOriginalPayload() throws Exception {
        MemoryUpdateWorker worker = worker((system, user) -> {
            assertThat(TransactionSynchronizationManager.isActualTransactionActive()).isFalse();
            jdbc.update("UPDATE external_operations SET lease_expires_at=? WHERE id=?",
                    NOW.minusSeconds(1).atOffset(ZoneOffset.UTC), operationId);
            return generated("새 목표");
        });

        assertThat(worker.runOnce(NOW)).isTrue();

        assertThat(memory.list(userId)).containsExactly(new MemoryEntry("goal", "새 목표", false, sessionId));
        var operation = jdbc.queryForMap("""
                SELECT status,attempt_count,response_payload::text AS payload,lease_token,lease_expires_at
                FROM external_operations WHERE id=?
                """, operationId);
        assertThat(operation).containsEntry("status", "succeeded").containsEntry("attempt_count", 1)
                .containsEntry("lease_token", null).containsEntry("lease_expires_at", null);
        assertThat(mapper.readTree((String) operation.get("payload"))).isEqualTo(mapper.readTree(
                "{\"practice_session_id\":\"" + sessionId + "\",\"updated_fields\":[\"goal\"]}"));
        assertThat(reporter.reports()).isEmpty();
        assertThat(worker.runOnce(NOW.plusSeconds(1))).isFalse();
    }

    @Test
    void actorEditDuringExtractionWinsAndIsExcludedFromThePayload() throws Exception {
        MemoryUpdateWorker worker = worker((system, user) -> {
            memory.writeAsActor(userId, ActorMemoryField.GOAL, "직접 쓴 목표");
            return new GeneratedText("{\"goal\":\"새 목표\",\"speech_self\":\"새 화법\"}", new TokenUsage(0, 0, 0));
        });

        assertThat(worker.runOnce(NOW)).isTrue();

        assertThat(memory.list(userId)).containsExactly(
                new MemoryEntry("goal", "직접 쓴 목표", true, null),
                new MemoryEntry("speech_self", "새 화법", false, sessionId));
        assertThat(mapper.readTree(jdbc.queryForObject(
                "SELECT response_payload::text FROM external_operations WHERE id=?", String.class, operationId)))
                .isEqualTo(mapper.readTree("{\"practice_session_id\":\"" + sessionId
                        + "\",\"updated_fields\":[\"speech_self\"]}"));
    }

    @Test
    void extractionFailureKeepsPracticeAndExistingMemory() {
        memory.writeAsAgent(userId, ActorMemoryField.GOAL, "원래 목표", sessionId);
        RuntimeException failure = new IllegalStateException("model unavailable");
        MemoryUpdateWorker worker = worker((system, user) -> { throw failure; });

        assertThat(worker.runOnce(NOW)).isTrue();

        assertThat(memory.list(userId)).containsExactly(new MemoryEntry("goal", "원래 목표", false, sessionId));
        assertThat(jdbc.queryForMap("SELECT status,error_code FROM external_operations WHERE id=?", operationId))
                .containsEntry("status", "failed").containsEntry("error_code", "memory_update_failed");
        assertThat(jdbc.queryForObject("SELECT status FROM practice_sessions WHERE id=?", String.class, sessionId))
                .isEqualTo("analyzed");
        assertThat(reporter.reports()).singleElement().satisfies(report -> {
            assertThat(report.failure()).isSameAs(failure);
            assertThat(report.context()).isEqualTo("MemoryUpdateWorker.update operation_id=" + operationId);
        });
    }

    @Test
    void concurrentPracticesWithOppositeFieldOrderBothCompleteAndKeepPayloadOrder() throws Exception {
        UUID secondSession = UUID.randomUUID();
        UUID secondOperation = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO practice_sessions
                    (id,user_id,upload_intent_id,status,situation,character_context,blockage_kind,sub_branch,goal)
                SELECT ?,user_id,upload_intent_id,status,situation,character_context,blockage_kind,sub_branch,goal
                FROM practice_sessions WHERE id=?
                """, secondSession, sessionId);
        jdbc.execute("""
                CREATE FUNCTION pause_first_memory() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN PERFORM pg_advisory_xact_lock(498002); RETURN NEW; END $$
                """);
        jdbc.execute("""
                CREATE TRIGGER pause_first_memory AFTER INSERT ON actor_memory_entries
                FOR EACH ROW WHEN (NEW.field = 'goal' AND NEW.value = '첫 목표')
                EXECUTE FUNCTION pause_first_memory()
                """);
        MemoryUpdateWorker first = worker((system, user) -> new GeneratedText(
                "{\"goal\":\"첫 목표\",\"blockage\":\"첫 막힘\"}", new TokenUsage(0, 0, 0)));
        MemoryUpdateWorker second = worker((system, user) -> new GeneratedText(
                "{\"blockage\":\"둘째 막힘\",\"goal\":\"둘째 목표\"}", new TokenUsage(0, 0, 0)));

        try (var executor = Executors.newFixedThreadPool(2);
                Connection gate = dataSource.getConnection()) {
            try (Statement statement = gate.createStatement()) {
                statement.execute("SELECT pg_advisory_lock(498002)");
            }
            try {
                var firstResult = executor.submit(() -> first.runOnce(NOW));
                awaitBlockedMemoryWrites(1);
                // 첫 워커가 원장을 선점한 후에만 두 번째 작업을 공개한다.
                jdbc.update("""
                        INSERT INTO external_operations
                            (id,session_id,user_id,request_id,kind,request_fingerprint)
                        VALUES (?,?,?,?,'memory_update',?)
                        """, secondOperation, secondSession, userId, UUID.randomUUID(), "b".repeat(64));
                var secondResult = executor.submit(() -> second.runOnce(NOW));
                awaitBlockedMemoryWrites(2);
                try (Statement statement = gate.createStatement()) {
                    statement.execute("SELECT pg_advisory_unlock(498002)");
                }
                assertThat(firstResult.get(10, TimeUnit.SECONDS)).isTrue();
                assertThat(secondResult.get(10, TimeUnit.SECONDS)).isTrue();
            } finally {
                try (Statement statement = gate.createStatement()) {
                    statement.execute("SELECT pg_advisory_unlock_all()");
                }
            }
        }

        assertThat(jdbc.queryForList("SELECT status FROM external_operations ORDER BY id", String.class))
                .containsExactly("succeeded", "succeeded");
        assertThat(memory.list(userId)).containsExactly(
                new MemoryEntry("goal", "둘째 목표", false, secondSession),
                new MemoryEntry("blockage", "둘째 막힘", false, secondSession));
        assertThat(mapper.readTree(jdbc.queryForObject(
                "SELECT response_payload::text FROM external_operations WHERE id=?", String.class, secondOperation)))
                .isEqualTo(mapper.readTree("{\"practice_session_id\":\"" + secondSession
                        + "\",\"updated_fields\":[\"blockage\",\"goal\"]}"));
        assertThat(reporter.reports()).isEmpty();
    }

    /** advisory gate와 행 잠금은 실행 순서만 제어하고 결과는 공개 워커/저장 계약에서 확인한다. */
    private void awaitBlockedMemoryWrites(int expected) throws Exception {
        Instant deadline = Instant.now().plusSeconds(5);
        while (Instant.now().isBefore(deadline)) {
            Integer blocked = jdbc.queryForObject("""
                    SELECT count(*) FROM pg_stat_activity
                    WHERE datname = current_database() AND wait_event_type = 'Lock'
                      AND query LIKE '%INSERT INTO actor_memory_entries%'
                    """, Integer.class);
            if (blocked != null && blocked >= expected) {
                return;
            }
            Thread.sleep(10);
        }
        throw new AssertionError("memory writes did not reach the expected lock waits: " + expected);
    }

    private MemoryUpdateWorker worker(TextGenerator generator) {
        return new MemoryUpdateWorker(memory, queue, mapper, generator,
                Clock.fixed(NOW, ZoneOffset.UTC), new MemoryExtractor(reporter), reporter);
    }

    private GeneratedText generated(String goal) {
        return new GeneratedText("{\"goal\":\"" + goal + "\"}", new TokenUsage(0, 0, 0));
    }
}
