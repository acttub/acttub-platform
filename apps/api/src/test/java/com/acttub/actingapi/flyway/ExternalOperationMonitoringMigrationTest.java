package com.acttub.actingapi.flyway;

import static com.acttub.actingapi.flyway.FlywaySupport.applyRawBaseline;
import static com.acttub.actingapi.flyway.FlywaySupport.committedCount;
import static com.acttub.actingapi.flyway.FlywaySupport.connect;
import static com.acttub.actingapi.flyway.FlywaySupport.dataSource;
import static com.acttub.actingapi.flyway.FlywaySupport.flywayFor;
import static org.assertj.core.api.Assertions.assertThat;

import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.coach.adapter.db.CoachStorageFixtures;
import com.acttub.actingapi.support.PostgresContainerSupport;
import com.acttub.actingapi.support.SchemaFingerprint;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.jdbc.core.JdbcTemplate;

class ExternalOperationMonitoringMigrationTest {

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void deployedThreeLayerV5AcceptsMonitoringWithoutChangingHistoryOrExistingRows(boolean baselined)
            throws Exception {
        String url = PostgresContainerSupport.createDatabase("monitoring_after_three_layers");
        if (baselined) {
            applyRawBaseline(url);
            flywayFor(url).baseline();
        }
        Flyway.configure().dataSource(dataSource(url)).locations("classpath:db/migration")
                .target("5").load().migrate();
        var jdbc = new JdbcTemplate(dataSource(url));
        List<String> history = jdbc.queryForList(
                "SELECT version || '|' || type || '|' || coalesce(checksum::text, 'null') "
                        + "FROM flyway_schema_history ORDER BY installed_rank", String.class);
        assertThat(jdbc.queryForObject(
                "SELECT script FROM flyway_schema_history WHERE version='5'", String.class))
                .isEqualTo("V5__three_layer_coaching.sql");

        var fixtures = new CoachStorageFixtures(jdbc);
        UUID user = fixtures.insertUser();
        var practice = fixtures.insertPractice(user);
        UUID summary = fixtures.insertSummary(practice.id());
        UUID coach = UUID.randomUUID();
        var now = CoachStorageFixtures.NOW.atOffset(ZoneOffset.UTC);
        fixtures.insertCoachSession(coach, practice.id(), summary, "closed", now, List.of());
        UUID handoff = fixtures.insertHandoff(coach, practice.id(), now);
        UUID operation = fixtures.insertRunningCoachStartOperation(user, practice.id(), UUID.randomUUID());
        jdbc.update("UPDATE practice_sessions SET experience_version='three_layers_v1' WHERE id=?", practice.id());
        jdbc.update("""
                UPDATE coach_sessions SET coaching_state_json='{"revision":2}',
                    state_revision=2, close_reason='actor_finished' WHERE id=?
                """, coach);
        jdbc.update("UPDATE coaching_handoffs SET branch_kind='coaching', state_revision=2 WHERE id=?", handoff);
        jdbc.update("INSERT INTO practice_reports (practice_session_id, source_handoff_id, report_type, report_json) "
                + "VALUES (?, ?, 'practice_note', '{\"report_type\":\"practice_note\",\"mode\":\"record_only\"}')",
                practice.id(), handoff);
        jdbc.update("UPDATE external_operations SET status='failed', error_code='historical_failure', "
                + "lease_token=NULL, lease_expires_at=NULL WHERE id=?", operation);
        List<String> tables = List.of("practice_sessions", "coach_sessions", "coaching_handoffs",
                "practice_reports", "external_operations");
        List<String> before = tables.stream().map(table -> originalRow(jdbc, table)).toList();

        var result = flywayFor(url).migrate();

        assertThat(result.migrationsExecuted).isEqualTo(committedCount() - 5);
        assertThat(result.migrations.getFirst().version).isEqualTo("6");
        assertThat(jdbc.queryForList(
                "SELECT version || '|' || type || '|' || coalesce(checksum::text, 'null') "
                        + "FROM flyway_schema_history WHERE version::int <= 5 ORDER BY installed_rank", String.class))
                .containsExactlyElementsOf(history);
        assertThat(tables.stream().map(table -> originalRow(jdbc, table)).toList()).containsExactlyElementsOf(before);
        assertThat(jdbc.queryForObject("""
                SELECT count(*) FROM external_operations WHERE id=?
                    AND last_failure_classification IS NULL AND waiting_since IS NULL
                    AND execution_started_at IS NULL AND monitoring_updated_at IS NULL
                    AND monitoring_lease_token IS NULL
                """, Long.class, operation)).isEqualTo(1);
        try (var connection = connect(url)) {
            assertThat(SchemaFingerprint.of(connection)).containsExactlyElementsOf(SchemaFingerprint.expected());
        }
        assertThat(flywayFor(url).migrate().migrationsExecuted).isZero();
    }

    private static String originalRow(JdbcTemplate jdbc, String table) {
        return jdbc.queryForObject("SELECT (to_jsonb(stored) - ARRAY['last_failure_classification', 'waiting_since', "
                + "'execution_started_at', 'monitoring_updated_at', 'monitoring_lease_token'])::text FROM "
                + table + " stored", String.class);
    }
}
