package com.acttub.actingapi.platform.operation;

import static org.assertj.core.api.Assertions.assertThat;

import java.sql.Connection;
import java.sql.Statement;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.UUID;

import javax.sql.DataSource;

import com.acttub.actingapi.support.MonitoringFailureFixture;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * 옛 원장({@code external_operations})의 상태 표본 게이지. 옛 큐 워커와 카운터는 SOMA-1140 에서 지웠고, 표를 지울 때까지
 * 이 표본이 남은 행의 수와 가장 오래된 시각을 낸다.
 */
@SpringBootTest(properties = {"JWT_SECRET=test-secret", "EXTERNAL_OPERATION_SNAPSHOT_MS=25"})
@Import(MonitoringFailureFixture.class)
class ExternalOperationSnapshotIT {
    private static final Instant NOW = Instant.parse("2026-08-08T01:02:03.456789Z");
    private static final String FINGERPRINT = "a".repeat(64);

    @Autowired
    JdbcTemplate jdbc;

    @Autowired
    DataSource dataSource;

    @Autowired
    io.micrometer.core.instrument.MeterRegistry meters;

    @Autowired
    MonitoringFailureFixture.Sink reporting;

    @BeforeEach
    void clearDatabase() {
        jdbc.execute("TRUNCATE TABLE users RESTART IDENTITY CASCADE");
    }

    @Test
    void previousApplicationSqlInvalidatesStaleTimes() {
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
}
