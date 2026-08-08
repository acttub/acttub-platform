package com.acttub.actingapi.report;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Map;
import java.util.UUID;

import com.acttub.actingapi.support.PostgresContainerSupport;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.ConnectionCallback;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * M0의 옛 {@code complete_report_operation} 테스트를 현재 함수에 재조준한다.
 *
 * <p>M3 사양은 "커넥션 풀을 1로 묶어 같은 커넥션에서 즉시 새 트랜잭션이 성공하는지"를 요구한다.
 * 그런데 {@code hikari.maximum-pool-size=1} 을 클래스 프로퍼티로 걸면 <b>부팅 자체가 죽는다</b> —
 * Flyway initializer 가 그 하나뿐인 커넥션을 잡은 채로 EntityManagerFactory 가 다시 요청해
 * 30초 뒤 {@code Connection is not available} 로 타임아웃한다. 그래서 풀을 좁히는 대신
 * {@link #sqlFailureRollsBackAndTheSameConnectionAcceptsANewTransaction()} 이
 * <b>같은 물리 커넥션</b>을 직접 붙잡고 그 위에서 실패 트랜잭션과 새 트랜잭션을 순차로 돌린다.
 * 검증하려던 것("Postgres 가 커넥션을 aborted 로 남기지 않는다")은 이 편이 더 직접적이다.
 */
@SpringBootTest(properties = "JWT_SECRET=test-secret")
class ReportOperationIT {

    @DynamicPropertySource
    static void datasource(DynamicPropertyRegistry registry) {
        String database = PostgresContainerSupport.createDatabaseName("report_operation_it");
        registry.add("spring.datasource.url", () -> PostgresContainerSupport.jdbcUrlFor(database));
        registry.add("spring.datasource.username", PostgresContainerSupport.POSTGRES::getUsername);
        registry.add("spring.datasource.password", PostgresContainerSupport.POSTGRES::getPassword);
    }

    @Autowired
    JdbcTemplate jdbc;

    @Autowired
    ReportOperationService service;

    @Autowired
    ReportOperationWork work;

    @Autowired
    PlatformTransactionManager transactionManager;

    ReportFixtures fixtures;

    @BeforeEach
    void setUp() {
        fixtures = new ReportFixtures(jdbc);
    }

    @Test
    void successfulInsertFinishesOperationAndReturnsTrue() {
        ReportFixtures.Scenario scenario = fixtures.create();

        boolean completed = complete(scenario, scenario.leaseToken());

        assertThat(completed).isTrue();
        assertThat(reportCount(scenario.sourceHandoffId())).isEqualTo(1);
        Map<String, Object> operation = operation(scenario.operationId());
        assertThat(operation.get("status")).isEqualTo("succeeded");
        assertThat(operation.get("lease_token")).isNull();
        assertThat(operation.get("lease_expires_at")).isNull();
        assertThat(responsePayloadMatches(scenario.operationId())).isTrue();
    }

    @Test
    void duplicateSourceHandoffReturnsFalseWithoutCreatingAnotherRow() {
        ReportFixtures.Scenario scenario = fixtures.create();
        UUID existingReportId = fixtures.insertPracticeReport(scenario);

        boolean completed = complete(scenario, scenario.leaseToken());

        assertThat(completed).isFalse();
        assertThat(reportCount(scenario.sourceHandoffId())).isEqualTo(1);
        assertThat(reportId(scenario.sourceHandoffId())).isEqualTo(existingReportId);
        assertThat(operation(scenario.operationId()).get("status")).isEqualTo("running");
    }

    @Test
    void lostLeaseRollsBackTheJustInsertedPracticeReport() {
        ReportFixtures.Scenario scenario = fixtures.create();

        assertThatThrownBy(() -> complete(scenario, UUID.randomUUID()))
                .isInstanceOf(LeaseOwnershipException.class)
                .hasMessage("external operation lease is not owned");

        assertThat(reportCount(scenario.sourceHandoffId())).isZero();
        assertThat(operation(scenario.operationId()).get("status")).isEqualTo("running");
    }

    @Test
    void markerWriteInTheSameTransactionRollsBackWithLostLease() {
        ReportFixtures.Scenario scenario = fixtures.create();
        UUID markerId = UUID.randomUUID();
        TransactionTemplate transaction = requiredTransaction();

        assertThatThrownBy(() -> transaction.executeWithoutResult(status -> {
            insertMarker(markerId);
            work.execute(
                    scenario.operationId(),
                    UUID.randomUUID(),
                    scenario.practiceSessionId(),
                    "analysis",
                    ReportFixtures.reportJson(),
                    scenario.sourceHandoffId(),
                    ReportFixtures.responsePayload(),
                    ReportFixtures.NOW.atOffset(ZoneOffset.UTC));
        }))
                .isInstanceOf(LeaseOwnershipException.class);

        assertThat(userExists(markerId)).isFalse();
        assertThat(reportCount(scenario.sourceHandoffId())).isZero();
    }

    @Test
    void expiredButUnclaimedLeaseMayStillComplete() {
        ReportFixtures.Scenario scenario = fixtures.create();
        jdbc.update("""
                UPDATE external_operations
                SET lease_expires_at = ?
                WHERE id = ?
                """,
                ReportFixtures.NOW.minusSeconds(1).atOffset(ZoneOffset.UTC),
                scenario.operationId());

        assertThat(complete(scenario, scenario.leaseToken())).isTrue();
        assertThat(reportCount(scenario.sourceHandoffId())).isEqualTo(1);
    }

    @Test
    void sqlFailureRollsBackAndTheSameConnectionAcceptsANewTransaction() {
        ReportFixtures.Scenario scenario = fixtures.create();

        assertThatThrownBy(() -> service.completePracticeReportOperation(
                scenario.operationId(),
                scenario.leaseToken(),
                scenario.practiceSessionId(),
                "invalid-report-type",
                ReportFixtures.reportJson(),
                scenario.sourceHandoffId(),
                ReportFixtures.responsePayload(),
                ReportFixtures.NOW))
                .isInstanceOf(DataIntegrityViolationException.class);

        UUID markerId = UUID.randomUUID();
        requiredTransaction().executeWithoutResult(status -> insertMarker(markerId));
        assertThat(userExists(markerId)).isTrue();
        assertThat(reportCount(scenario.sourceHandoffId())).isZero();

        // 위 실패가 커넥션을 aborted 로 남겼다면 같은 물리 커넥션의 다음 문장이 25P02 로 터진다.
        // 풀을 1로 좁히는 대신 커넥션 하나를 직접 붙잡아 그 위에서 확인한다(클래스 주석 참조).
        UUID sameConnectionMarker = UUID.randomUUID();
        jdbc.execute((ConnectionCallback<Void>) connection -> {
            boolean autoCommit = connection.getAutoCommit();
            connection.setAutoCommit(false);
            try {
                try (PreparedStatement doomed = connection.prepareStatement(
                        // report_type 은 enum 이 아니라 text 다 — 캐스팅하면 존재하지 않는
                        // 타입이라 문법 오류로 죽고, 여기서 의도한 CHECK 제약 위반에 닿지 못한다.
                        "INSERT INTO practice_reports (id, practice_session_id, report_type,"
                                + " report_json, source_handoff_id)"
                                + " VALUES (?, ?, ?, ?::jsonb, ?)")) {
                    doomed.setObject(1, UUID.randomUUID());
                    doomed.setObject(2, scenario.practiceSessionId());
                    doomed.setString(3, "invalid-report-type");
                    doomed.setString(4, ReportFixtures.reportJson().toString());
                    doomed.setObject(5, scenario.sourceHandoffId());
                    assertThatThrownBy(doomed::executeUpdate).isInstanceOf(SQLException.class);
                }
                connection.rollback();

                try (PreparedStatement recovered = connection.prepareStatement(
                        "INSERT INTO users (id, email, status) VALUES (?, ?, 'active'::user_status_t)")) {
                    recovered.setObject(1, sameConnectionMarker);
                    recovered.setString(2, sameConnectionMarker + "@same-connection.test");
                    recovered.executeUpdate();
                }
                connection.commit();
            } finally {
                connection.setAutoCommit(autoCommit);
            }
            return null;
        });
        assertThat(userExists(sameConnectionMarker)).isTrue();
    }

    @Test
    void reportAndOperationUseTheSameCompletionTimestamp() {
        ReportFixtures.Scenario scenario = fixtures.create();

        assertThat(complete(scenario, scenario.leaseToken())).isTrue();

        OffsetDateTime reportCreatedAt = jdbc.queryForObject("""
                SELECT created_at
                FROM practice_reports
                WHERE source_handoff_id = ?
                """, OffsetDateTime.class, scenario.sourceHandoffId());
        OffsetDateTime operationUpdatedAt = jdbc.queryForObject("""
                SELECT updated_at
                FROM external_operations
                WHERE id = ?
                """, OffsetDateTime.class, scenario.operationId());
        assertThat(reportCreatedAt).isEqualTo(ReportFixtures.NOW.atOffset(ZoneOffset.UTC));
        assertThat(operationUpdatedAt).isEqualTo(ReportFixtures.NOW.atOffset(ZoneOffset.UTC));
    }

    private boolean complete(ReportFixtures.Scenario scenario, UUID leaseToken) {
        return service.completePracticeReportOperation(
                scenario.operationId(),
                leaseToken,
                scenario.practiceSessionId(),
                "analysis",
                ReportFixtures.reportJson(),
                scenario.sourceHandoffId(),
                ReportFixtures.responsePayload(),
                ReportFixtures.NOW);
    }

    private TransactionTemplate requiredTransaction() {
        TransactionTemplate transaction = new TransactionTemplate(transactionManager);
        transaction.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        return transaction;
    }

    private void insertMarker(UUID markerId) {
        jdbc.update("""
                INSERT INTO users (id, email, status)
                VALUES (?, ?, 'active'::user_status_t)
                """, markerId, markerId + "@marker.test");
    }

    private boolean userExists(UUID userId) {
        Long count = jdbc.queryForObject(
                "SELECT count(*) FROM users WHERE id = ?",
                Long.class,
                userId);
        return count != null && count > 0;
    }

    private long reportCount(UUID sourceHandoffId) {
        Long count = jdbc.queryForObject("""
                SELECT count(*)
                FROM practice_reports
                WHERE source_handoff_id = ?
                """, Long.class, sourceHandoffId);
        return count == null ? 0L : count;
    }

    private UUID reportId(UUID sourceHandoffId) {
        return jdbc.queryForObject("""
                SELECT id
                FROM practice_reports
                WHERE source_handoff_id = ?
                """, UUID.class, sourceHandoffId);
    }

    private Map<String, Object> operation(UUID operationId) {
        return jdbc.queryForMap("""
                SELECT
                    status::text AS status,
                    lease_token,
                    lease_expires_at
                FROM external_operations
                WHERE id = ?
                """, operationId);
    }

    private boolean responsePayloadMatches(UUID operationId) {
        Boolean matches = jdbc.queryForObject("""
                SELECT response_payload = ?::jsonb
                FROM external_operations
                WHERE id = ?
                """,
                Boolean.class,
                ReportFixtures.responsePayload().toString(),
                operationId);
        return Boolean.TRUE.equals(matches);
    }
}
