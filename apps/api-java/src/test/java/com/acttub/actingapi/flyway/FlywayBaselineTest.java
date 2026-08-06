package com.acttub.actingapi.flyway;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.List;

import com.acttub.actingapi.support.PostgresContainerSupport;
import com.acttub.actingapi.support.SchemaFingerprint;
import org.flywaydb.core.Flyway;
import org.flywaydb.core.api.MigrationInfo;
import org.flywaydb.core.api.CoreMigrationType;
import org.flywaydb.core.api.output.MigrateResult;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.datasource.SimpleDriverDataSource;

/**
 * {@code /SPEC.md} §5-5 의 두 경로를 <b>둘 다</b> 돌린다.
 *
 * <ul>
 *   <li>(a) 빈 DB → {@code V1__baseline.sql} 실행 → alembic 결과와 스키마가 같아야 한다.
 *       M6 에서 파이썬을 지우면 이것이 <b>유일한 스키마 생성 수단</b>이 된다.</li>
 *   <li>(b) 이미 alembic 이 만들어 둔 DB → 같은 V1 버전으로 baseline <b>기록만</b>.
 *       DDL 이 돌면 안 된다.</li>
 * </ul>
 */
class FlywayBaselineTest {

    private static Flyway flywayFor(String jdbcUrl) {
        return Flyway.configure()
                .dataSource(dataSource(jdbcUrl))
                .locations("classpath:db/migration")
                .baselineVersion("1")
                .baselineDescription("baseline")
                .load();
    }

    private static SimpleDriverDataSource dataSource(String jdbcUrl) {
        SimpleDriverDataSource ds = new SimpleDriverDataSource();
        ds.setDriverClass(org.postgresql.Driver.class);
        ds.setUrl(jdbcUrl);
        ds.setUsername(PostgresContainerSupport.POSTGRES.getUsername());
        ds.setPassword(PostgresContainerSupport.POSTGRES.getPassword());
        return ds;
    }

    // ---- (a) 빈 DB 재구축 ----

    @Test
    @DisplayName("빈 DB 에 V1 을 실행하면 alembic upgrade head 와 스키마가 완전히 같다")
    void freshDatabaseRebuildMatchesAlembic() throws Exception {
        String jdbcUrl = PostgresContainerSupport.createDatabase("flyway_fresh");

        MigrateResult result = flywayFor(jdbcUrl).migrate();

        assertThat(result.migrationsExecuted).isEqualTo(1);
        assertThat(result.migrations.get(0).version).isEqualTo("1");

        try (Connection connection = connect(jdbcUrl)) {
            List<String> actual = SchemaFingerprint.of(connection);
            List<String> expected = SchemaFingerprint.expectedFromAlembic();

            // 차이가 있으면 어느 줄인지 그대로 보여준다 — "diff 0" 이 완료 기준이다.
            assertThat(actual).containsExactlyElementsOf(expected);
        }
    }

    @Test
    @DisplayName("재구축된 스키마에 20 테이블 · 17 enum · 부분 인덱스 3 · CHECK 제약이 다 있다")
    void freshDatabaseHasTheObjectsThatHibernateCannotCreate() throws Exception {
        String jdbcUrl = PostgresContainerSupport.createDatabase("flyway_objects");
        flywayFor(jdbcUrl).migrate();

        try (Connection connection = connect(jdbcUrl)) {
            // 개수를 박아두면 apps/api 에 마이그레이션이 추가될 때마다 깨진다.
            // alembic fingerprint fixture 에서 세어 자동으로 따라가게 한다.
            // (fixture 는 scripts/regen-baseline.sh 가 alembic HEAD 에서 만든다)
            List<String> alembic = SchemaFingerprint.expectedFromAlembic();
            long expectedTables = alembic.stream().filter(l -> l.startsWith("TABLE ")).count();
            long expectedEnums = alembic.stream().filter(l -> l.startsWith("ENUM ")).count();

            assertThat(scalar(connection,
                    "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' "
                            + "AND table_type='BASE TABLE' AND table_name <> 'flyway_schema_history'"))
                    .isEqualTo(expectedTables);

            assertThat(scalar(connection,
                    "SELECT count(DISTINCT t.typname) FROM pg_type t "
                            + "JOIN pg_enum e ON e.enumtypid=t.oid "
                            + "JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public'"))
                    .isEqualTo(expectedEnums);

            // /SPEC.md §5-3-6 — Hibernate 가 만들지도 검증하지도 못하는 것들.
            assertThat(scalar(connection,
                    "SELECT count(*) FROM pg_indexes WHERE schemaname='public' "
                            + "AND indexdef LIKE '%WHERE%'"))
                    .isEqualTo(3L);
            assertThat(scalar(connection,
                    "SELECT count(*) FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid "
                            + "JOIN pg_namespace n ON n.oid=c.relnamespace "
                            + "WHERE n.nspname='public' AND con.contype='c'"))
                    .isEqualTo(1L);

            // /SPEC.md §6 #10 — 중복 리포트 판정이 이 제약명에 의존한다.
            assertThat(scalar(connection,
                    "SELECT count(*) FROM pg_constraint WHERE conname='reports_session_id_key'"))
                    .isEqualTo(1L);

            // 한글 라벨 enum. values_callable 때문에 DB 값이 한글이다 (/SPEC.md §5-3-1).
            try (Statement st = connection.createStatement();
                    ResultSet rs = st.executeQuery(
                            "SELECT string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder) "
                                    + "FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid "
                                    + "WHERE t.typname='intent_impact_t'")) {
                rs.next();
                assertThat(rs.getString(1)).isEqualTo("반전,약화,국소");
            }

            // 0005 의 시드 데이터도 V1 이 들고 있어야 한다.
            assertThat(scalar(connection, "SELECT count(*) FROM community_categories")).isEqualTo(3L);
        }
    }

    // ---- (b) 기존 DB baseline ----

    @Test
    @DisplayName("이미 스키마가 있는 DB 에는 baseline 기록만 남고 DDL 이 돌지 않는다")
    void existingDatabaseGetsBaselineOnly() throws Exception {
        String jdbcUrl = PostgresContainerSupport.createDatabase("flyway_existing");

        // dev·운영의 현 상태 재현: alembic 이 만들어 둔 스키마.
        // V1__baseline.sql 이 alembic 결과와 바이트 단위로 같음은 위 테스트가 보장하므로 그대로 실행한다.
        applyRawBaseline(jdbcUrl);

        List<String> before;
        try (Connection connection = connect(jdbcUrl)) {
            before = SchemaFingerprint.of(connection);
            assertThat(scalar(connection,
                    "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' "
                            + "AND table_name='flyway_schema_history'")).isEqualTo(0L);
        }

        Flyway flyway = flywayFor(jdbcUrl);
        flyway.baseline();

        try (Connection connection = connect(jdbcUrl)) {
            // fingerprint 에서 flyway_schema_history 는 제외되므로, 변화가 0 이면 DDL 이 안 돈 것이다.
            assertThat(SchemaFingerprint.of(connection)).isEqualTo(before);
            assertThat(scalar(connection,
                    "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' "
                            + "AND table_name='flyway_schema_history'")).isEqualTo(1L);
            // 데이터도 그대로다 — V1 의 시드 INSERT 가 다시 돌지 않았다.
            assertThat(scalar(connection, "SELECT count(*) FROM community_categories")).isEqualTo(3L);
        }

        MigrationInfo[] applied = flyway.info().applied();
        assertThat(applied).hasSize(1);
        assertThat(applied[0].getType()).isEqualTo(CoreMigrationType.BASELINE);
        assertThat(applied[0].getVersion().getVersion()).isEqualTo("1");

        // baseline 이후 migrate 를 다시 불러도 V1 은 실행되지 않는다(같은 버전이므로 건너뛴다).
        MigrateResult second = flywayFor(jdbcUrl).migrate();
        assertThat(second.migrationsExecuted).isZero();

        try (Connection connection = connect(jdbcUrl)) {
            assertThat(SchemaFingerprint.of(connection)).isEqualTo(before);
            assertThat(scalar(connection, "SELECT count(*) FROM community_categories")).isEqualTo(3L);
        }
    }

    @Test
    @DisplayName("baseline-on-migrate 는 꺼져 있다 — 애플리케이션이 조용히 baseline 을 찍으면 안 된다")
    void applicationDoesNotBaselineSilently() throws Exception {
        String jdbcUrl = PostgresContainerSupport.createDatabase("flyway_no_auto_baseline");
        applyRawBaseline(jdbcUrl);

        // application.yml 과 같은 설정(baseline-on-migrate: false)으로 migrate 하면
        // "빈 DB 가 아닌데 이력이 없다"고 거부한다. 이 실패가 곧 안전장치다.
        Flyway flyway = Flyway.configure()
                .dataSource(dataSource(jdbcUrl))
                .locations("classpath:db/migration")
                .baselineOnMigrate(false)
                .load();

        assertThat(org.assertj.core.api.Assertions.catchThrowable(flyway::migrate))
                .isInstanceOf(org.flywaydb.core.api.FlywayException.class)
                .hasMessageContaining("no schema history table");
    }

    // ---- helpers ----

    private static Connection connect(String jdbcUrl) throws SQLException {
        return DriverManager.getConnection(jdbcUrl,
                PostgresContainerSupport.POSTGRES.getUsername(),
                PostgresContainerSupport.POSTGRES.getPassword());
    }

    private static long scalar(Connection connection, String sql) throws SQLException {
        try (Statement st = connection.createStatement(); ResultSet rs = st.executeQuery(sql)) {
            rs.next();
            return rs.getLong(1);
        }
    }

    private static void applyRawBaseline(String jdbcUrl) throws SQLException, IOException {
        String sql;
        try (InputStream in = FlywayBaselineTest.class
                .getResourceAsStream("/db/migration/V1__baseline.sql")) {
            sql = new String(in.readAllBytes(), StandardCharsets.UTF_8);
        }
        try (Connection connection = connect(jdbcUrl); Statement st = connection.createStatement()) {
            st.execute(sql);
        }
    }
}
