package com.acttub.actingapi.flyway;

import static com.acttub.actingapi.flyway.FlywaySupport.applyRawBaseline;
import static com.acttub.actingapi.flyway.FlywaySupport.baselineSql;
import static com.acttub.actingapi.flyway.FlywaySupport.committedCount;
import static com.acttub.actingapi.flyway.FlywaySupport.connect;
import static com.acttub.actingapi.flyway.FlywaySupport.dataSource;
import static com.acttub.actingapi.flyway.FlywaySupport.flywayFor;
import static com.acttub.actingapi.flyway.FlywaySupport.scalar;
import static org.assertj.core.api.Assertions.assertThat;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
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
import org.junit.jupiter.api.io.TempDir;

/**
 * {@code V1__baseline.sql} 이 지금 스키마를 그대로 세우는지, 그리고 <b>앞으로도 그대로일지</b>를 본다.
 *
 * <ul>
 *   <li>(a) 빈 DB → V1 실행 → 커밋된 fingerprint 와 같아야 한다. 파이썬이 사라진 뒤 이것이
 *       <b>유일한 스키마 생성 수단</b>이다.</li>
 *   <li>(b) 이미 스키마가 있는 DB → 같은 V1 버전으로 baseline <b>기록만</b>. DDL 이 돌면 안 된다.</li>
 *   <li>(c) V1 은 <b>동결</b>이다 — checksum 을 못박는다.</li>
 * </ul>
 *
 * <p>거기서 앞으로 가는 길(V2 이후)은 {@link FlywayForwardMigrationTest} 가 본다.
 */
class FlywayBaselineTest {

    /**
     * 빈 DB 에 V1 을 적용했을 때 Flyway 가 이력에 남기는 checksum.
     *
     * <p>손으로 정한 값이 아니라 <b>Flyway 가 계산한 값</b>이고, 실측 출처는
     * {@code spec/M6-findings.md} 발견 1 이다.
     */
    private static final long FROZEN_BASELINE_CHECKSUM = -1135202796L;

    @TempDir
    Path tamperedMigrations;

    // ---- (a) 빈 DB 재구축 ----

    @Test
    @DisplayName("빈 DB 에 마이그레이션 전부를 실행하면 커밋된 fingerprint 와 완전히 같다")
    void freshDatabaseRebuildMatchesTheCommittedFingerprint() throws Exception {
        String jdbcUrl = PostgresContainerSupport.createDatabase("flyway_fresh");

        MigrateResult result = flywayFor(jdbcUrl).migrate();

        // 개수를 박지 않는다 — V2__ 가 들어오면 이 검사가 따라가야 한다(FlywaySupport 주석).
        assertThat(result.migrationsExecuted).isEqualTo(committedCount());
        assertThat(result.migrations.get(0).version)
                .as("V1 이 맨 앞이다 — 빈 DB 는 baseline 이 아니라 V1 을 실제로 실행한다")
                .isEqualTo("1");

        try (Connection connection = connect(jdbcUrl)) {
            List<String> actual = SchemaFingerprint.of(connection);

            // 차이가 있으면 어느 줄인지 그대로 보여준다 — "diff 0" 이 완료 기준이다.
            assertThat(actual)
                    .as("스키마를 바꿨다면 apps/api/scripts/regen-fingerprint.sh 를 돌리고 "
                            + "결과를 함께 커밋하세요.")
                    .containsExactlyElementsOf(SchemaFingerprint.expected());
        }
    }

    @Test
    @DisplayName("재구축된 스키마에 테이블 · enum · 부분 인덱스 · CHECK 제약이 다 있다")
    void freshDatabaseHasTheObjectsThatHibernateCannotCreate() throws Exception {
        String jdbcUrl = PostgresContainerSupport.createDatabase("flyway_objects");
        flywayFor(jdbcUrl).migrate();

        try (Connection connection = connect(jdbcUrl)) {
            // 개수를 박아두면 스키마가 바뀔 때마다 두 곳을 고쳐야 한다.
            // 커밋된 fingerprint 에서 세어 자동으로 따라가게 한다.
            List<String> expected = SchemaFingerprint.expected();
            long expectedTables = expected.stream().filter(l -> l.startsWith("TABLE ")).count();
            long expectedEnums = expected.stream().filter(l -> l.startsWith("ENUM ")).count();
            long expectedPartialIndexes = expected.stream()
                    .filter(l -> l.startsWith("INDEX ") && l.contains(" WHERE ")).count();
            // PG18 은 NOT NULL 도 pg_constraint 에 물질화하므로(contype='n') 정의 텍스트로 가른다.
            long expectedChecks = expected.stream()
                    .filter(l -> l.startsWith("CONSTRAINT ") && l.contains(" CHECK (")).count();

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
                    .isEqualTo(expectedPartialIndexes);
            assertThat(scalar(connection,
                    "SELECT count(*) FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid "
                            + "JOIN pg_namespace n ON n.oid=c.relnamespace "
                            + "WHERE n.nspname='public' AND con.contype='c'"))
                    .isEqualTo(expectedChecks);

            // uq_practice_reports_source_handoff — 리포트 멱등 INSERT 의
            // ON CONFLICT 대상이다 (db/store.py:complete_practice_report_operation).
            assertThat(scalar(connection,
                    "SELECT count(*) FROM pg_constraint "
                            + "WHERE conname='uq_practice_reports_source_handoff'"))
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

            // 시드 데이터도 V1 이 전체 값 그대로 들고 있어야 한다.
            assertThat(categoryRows(connection)).containsExactly(
                    "free|자유|연습하다 든 생각, 근황, 잡담|10",
                    "admission|입시 Q&A|실기·전형·준비 과정에서 막힌 것 묻기|20",
                    "info|정보공유|공고·후기·자료처럼 남에게 도움 되는 것|30");
        }
    }

    // ---- (b) 기존 DB baseline ----

    @Test
    @DisplayName("이미 스키마가 있는 DB 에는 baseline 기록만 남고 DDL 이 돌지 않는다")
    void existingDatabaseGetsBaselineOnly() throws Exception {
        String jdbcUrl = PostgresContainerSupport.createDatabase("flyway_existing");

        // dev·운영의 현 상태 재현: alembic 이 만들어 둔 스키마.
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
        // ⚠ "아무것도 안 돈다" 로 세지 않는다 — V2__ 가 생기면 그것은 **돌아야 맞고**, 그때
        // 이 검사가 깨지면 안 된다. 여기서 보는 것은 V1 하나다.
        MigrateResult second = flywayFor(jdbcUrl).migrate();
        assertThat(second.migrations)
                .as("baseline 으로 기록된 V1 은 다시 실행되지 않는다")
                .noneMatch(applied2 -> "1".equals(applied2.version));

        try (Connection connection = connect(jdbcUrl)) {
            // V1 의 시드 INSERT 가 다시 돌았다면 여기가 3을 넘는다.
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

    // ---- (c) V1 동결 ----

    /**
     * <b>V1 을 고치면 dev·운영은 멀쩡한데 신규 환경만 죽는다.</b>
     *
     * <p>두 경로의 이력이 다르기 때문이다 — dev·운영은 {@code << Flyway Baseline >>}(type=BASELINE)
     * 이라 <b>checksum 이 아예 없고</b>, 신규 환경은 V1 을 SQL 로 밟아 checksum 을 갖는다. 그래서
     * V1 을 수정하면 그 자리에서는 아무 일도 일어나지 않고, <b>재해복구가 필요한 순간에</b>
     * {@code Migration checksum mismatch} 로 드러난다({@code spec/M6-findings.md} 발견 1 — 관측이
     * 아니라 재현했다).
     *
     * <p>스키마를 바꿔야 하면 V1 이 아니라 {@code V2__} 로 들어간다.
     */
    @Test
    @DisplayName("V1 은 동결이다 — checksum 을 못박는다")
    void baselineIsFrozen() throws Exception {
        String jdbcUrl = PostgresContainerSupport.createDatabase("flyway_frozen");
        flywayFor(jdbcUrl).migrate();

        try (Connection connection = connect(jdbcUrl)) {
            assertThat(baselineChecksum(connection))
                    .as("V1__baseline.sql 은 동결이다. 스키마 변경은 V2__ 로 새 파일을 만드세요 — "
                            + "V1 을 고치면 dev·운영은 멀쩡하고 신규 환경만 기동하지 못합니다.")
                    .isEqualTo(FROZEN_BASELINE_CHECKSUM);
        }
    }

    /** 반증 — 위 상수가 실제로 V1 의 내용에 묶여 있는지. 주석 한 줄로도 움직여야 한다. */
    @Test
    @DisplayName("반증 — V1 이 한 줄이라도 바뀌면 checksum 이 움직인다")
    void theFrozenChecksumMovesWhenV1Changes() throws Exception {
        Files.writeString(tamperedMigrations.resolve("V1__baseline.sql"),
                baselineSql() + "\n-- 반증용 주석 한 줄\n", StandardCharsets.UTF_8);

        String jdbcUrl = PostgresContainerSupport.createDatabase("flyway_tampered");
        Flyway.configure()
                .dataSource(dataSource(jdbcUrl))
                // 변조본만 본다 — classpath 를 함께 주면 같은 버전이 둘이 되어 죽는다.
                .locations(FlywaySupport.locationOf(tamperedMigrations))
                .load()
                .migrate();

        try (Connection connection = connect(jdbcUrl)) {
            assertThat(baselineChecksum(connection)).isNotEqualTo(FROZEN_BASELINE_CHECKSUM);
        }
    }

    // ---- helpers ----

    private static long baselineChecksum(Connection connection) throws SQLException {
        return scalar(connection,
                "SELECT checksum FROM flyway_schema_history WHERE version='1'");
    }

    private static List<String> categoryRows(Connection connection) throws SQLException {
        try (Statement st = connection.createStatement(); ResultSet rs = st.executeQuery(
                "SELECT slug,name,description,sort_order FROM community_categories ORDER BY sort_order,slug")) {
            java.util.ArrayList<String> rows = new java.util.ArrayList<>();
            while (rs.next()) {
                rows.add(rs.getString(1) + "|" + rs.getString(2) + "|" + rs.getString(3) + "|" + rs.getInt(4));
            }
            return rows;
        }
    }
}
