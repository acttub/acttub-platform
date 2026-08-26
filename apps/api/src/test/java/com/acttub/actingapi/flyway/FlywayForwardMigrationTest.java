package com.acttub.actingapi.flyway;

import static com.acttub.actingapi.flyway.FlywaySupport.applyRawBaseline;
import static com.acttub.actingapi.flyway.FlywaySupport.committedCount;
import static com.acttub.actingapi.flyway.FlywaySupport.connect;
import static com.acttub.actingapi.flyway.FlywaySupport.dataSource;
import static com.acttub.actingapi.flyway.FlywaySupport.flywayFor;
import static com.acttub.actingapi.flyway.FlywaySupport.nextFreeVersion;
import static com.acttub.actingapi.flyway.FlywaySupport.scalar;
import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
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
import org.flywaydb.core.api.output.MigrateResult;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/**
 * <b>dev·운영이 서 있는 자리에서 앞으로 갈 수 있는가.</b>
 *
 * <p>{@link FlywayBaselineTest} 는 "V1 이 지금 스키마를 재현한다" 까지만 본다. 그런데 dev·운영의
 * {@code flyway_schema_history} 에는 {@code << Flyway Baseline >>} 한 줄(type=BASELINE,
 * <b>checksum 없음</b>)만 있고, <b>Flyway 가 그 DB 에서 마이그레이션을 실행한 적이 한 번도 없다</b> —
 * V1 은 기록만 됐고 V2 는 존재하지 않는다.
 *
 * <p>{@code SOMA-403} 3단계가 스키마 소유권을 alembic 에서 Flyway 로 넘기므로, 그 미검증 경로가
 * 실제로 뚫려 있는지가 이 단계의 관문이다. 여기서 임시 프로브 마이그레이션을 <b>두 경로에 모두</b>
 * 통과시켜 본다.
 *
 * <ul>
 *   <li>경로 A — alembic 이 만든 스키마 + baseline 기록 (dev·운영)</li>
 *   <li>경로 B — 빈 DB 에 V1 부터 전부 적용 (신규 환경·재해복구)</li>
 * </ul>
 *
 * <p>프로브는 {@code db/migration} 에 커밋하지 않는다 — 실제 스키마를 바꾸지 않고 경로만 보려는
 * 것이라, 임시 디렉토리를 {@code filesystem:} 위치로 얹는다. 🔥 <b>버전은
 * {@link FlywaySupport#nextFreeVersion()} 이 뽑는다</b> — 손으로 {@code V2} 라고 박아 두면 진짜
 * {@code V2__} 가 들어오는 순간 {@code Found more than one migration with version 2} 로 죽고,
 * 그 실패는 스키마 문제가 아니라 이 검사가 낡은 것이다.
 *
 * <p>⚠ <b>이 테스트가 초록이어도 실서버에서 실제로 돈 것은 아니다.</b> 커밋된 마이그레이션이 V1
 * 뿐이라, dev·운영에서는 다음 스키마 변경 때 처음 돈다. 그래서 아래 반증들이 이 판정의 전부다 —
 * 경로 A 재현이 어긋나 있거나 "적용됐다" 를 세지 않고 있으면 위의 초록은 아무것도 뜻하지 않는다.
 */
class FlywayForwardMigrationTest {

    /** 실제 스키마 변경이 가장 흔히 하는 모양 — 컬럼 하나를 더한다. */
    private static final String PROBE_SQL =
            "ALTER TABLE public.users ADD COLUMN forward_probe_at timestamptz;\n";

    private static final String PROBE_COLUMN_COUNT =
            "SELECT count(*) FROM information_schema.columns "
                    + "WHERE table_schema='public' AND table_name='users' "
                    + "AND column_name='forward_probe_at'";

    @TempDir
    Path pendingMigrations;

    /** 프로브를 임시 위치에 놓고 그 Flyway 위치를 준다. */
    private String probeLocation(String sql) throws IOException {
        Files.writeString(pendingMigrations.resolve("V" + nextFreeVersion() + "__forward_probe.sql"),
                sql, StandardCharsets.UTF_8);
        return FlywaySupport.locationOf(pendingMigrations);
    }

    private String probeLocation() throws IOException {
        return probeLocation(PROBE_SQL);
    }

    // ---- 경로 A — dev·운영 ----

    @Test
    @DisplayName("baseline 기록만 있는 DB(dev·운영)가 다음 마이그레이션을 받는다")
    void baselinedDatabaseAcceptsTheNextMigration() throws Exception {
        String location = probeLocation();
        String jdbcUrl = baselinedDatabase("forward_baselined");

        // 먼저 출발점이 정말 dev·운영과 같은 모양인지 본다. 이것이 어긋나면 아래 초록은
        // 다른 DB 에 대한 판정이다 (docs/archive/soma287/M6-findings.md 발견 1 의 표).
        try (Connection connection = connect(jdbcUrl)) {
            assertThat(historyRows(connection))
                    .as("dev·운영은 BASELINE 한 줄뿐이고 checksum 이 없다")
                    .containsExactly("1|<< Flyway Baseline >>|BASELINE|null");
        }

        MigrateResult result = flywayFor(jdbcUrl, location).migrate();

        // baseline 이 V1 을 덮으므로 남는 것은 V2..Vn 과 프로브다.
        assertThat(result.migrationsExecuted).isEqualTo(committedCount());
        assertThat(result.migrations.get(result.migrations.size() - 1).version)
                .isEqualTo(nextFreeVersion());
        try (Connection connection = connect(jdbcUrl)) {
            assertThat(scalar(connection, PROBE_COLUMN_COUNT)).isEqualTo(1L);
        }
    }

    // ---- 경로 A 와 B 가 같은 곳에 도착하는가 ----

    @Test
    @DisplayName("두 경로가 같은 프로브를 받고 결과 스키마가 같다")
    void bothPathsEndUpWithTheSameSchema() throws Exception {
        String location = probeLocation();

        String baselined = baselinedDatabase("forward_parity_baselined");
        String fresh = PostgresContainerSupport.createDatabase("forward_parity_fresh");
        assertThat(flywayFor(fresh, location).migrate().migrationsExecuted)
                .as("신규 환경은 커밋된 것 전부와 프로브를 함께 받는다")
                .isEqualTo(committedCount() + 1);
        assertThat(flywayFor(baselined, location).migrate().migrationsExecuted)
                .isEqualTo(committedCount());

        try (Connection a = connect(baselined); Connection b = connect(fresh)) {
            assertThat(SchemaFingerprint.of(a)).containsExactlyElementsOf(SchemaFingerprint.of(b));
        }
    }

    /**
     * 마이그레이션이 <b>기동의 일부</b>가 된 지금(SOMA-403 3단계), 실패했을 때 DB 가 어떤 상태로
     * 남는지가 운영 대응 절차의 전제다({@code docs/deploy/DEPLOY-VPC.md} §4-3).
     *
     * <p>Postgres 는 DDL 이 트랜잭션 안에서 돌므로 <b>마이그레이션과 이력 기록이 함께 롤백된다</b> —
     * 실패 흔적이 남지 않고, 원인을 고쳐 다시 배포하면 그만이다. 손으로 이력을 지우거나
     * {@code repair} 를 돌릴 필요가 없다. 그 절차를 문서에 적기 전에 여기서 실제로 확인한다.
     */
    @Test
    @DisplayName("실패한 마이그레이션은 부분 적용도 이력도 남기지 않는다 (Postgres DDL 트랜잭션)")
    void aFailedMigrationLeavesNothingBehind() throws Exception {
        // 앞 문장은 성공하고 뒤 문장이 깨진다 — 부분 적용이 남는지 보려는 것이다.
        String location = probeLocation(
                PROBE_SQL + "ALTER TABLE public.nonexistent_table ADD COLUMN x integer;\n");
        String jdbcUrl = baselinedDatabase("forward_failed");

        assertThat(org.assertj.core.api.Assertions
                .catchThrowable(() -> flywayFor(jdbcUrl, location).migrate()))
                .isInstanceOf(org.flywaydb.core.api.FlywayException.class);

        try (Connection connection = connect(jdbcUrl)) {
            assertThat(scalar(connection, PROBE_COLUMN_COUNT))
                    .as("앞 문장까지 적용된 채로 남지 않는다")
                    .isZero();
            assertThat(historyRows(connection))
                    .as("이력에도 남지 않는다 — 실패 행을 지우는 절차가 필요 없다")
                    .noneMatch(row -> row.startsWith(nextFreeVersion() + "|"));
        }
    }

    // ---- 반증 — 위의 단언이 실제로 무언가를 세고 있는가 ----

    /**
     * 실제로 일어날 수 있는 실패 모드다: baseline 을 <b>적용할 마이그레이션보다 높은 버전</b>으로
     * 찍으면, 그 아래 마이그레이션이 예외 없이 <b>조용히 건너뛰어진다</b>. 스키마는 그대로인데
     * 이력에 "적용됨" 이 남지도 않아, 나중에 어디서 갈렸는지 알 길이 없다.
     *
     * <p>{@code ddl-auto: validate} 도 이것을 보증하지 못한다 — 건너뛴 마이그레이션이 Schema Entity
     * 와 무관한 것(인덱스·제약·시드)이면 앱은 멀쩡히 뜬다.
     */
    @Test
    @DisplayName("반증 — baseline 이 마이그레이션보다 높으면 조용히 건너뛴다")
    void aBaselineAheadOfTheMigrationSkipsItSilently() throws Exception {
        String location = probeLocation();
        String jdbcUrl = PostgresContainerSupport.createDatabase("forward_baseline_ahead");
        applyRawBaseline(jdbcUrl);

        Flyway ahead = Flyway.configure()
                .dataSource(dataSource(jdbcUrl))
                .locations("classpath:db/migration", location)
                // 이 한 값만 실물과 다르게 준다 — 그것이 반증이다.
                .baselineVersion(nextFreeVersion())
                .load();
        ahead.baseline();

        MigrateResult result = ahead.migrate();

        assertThat(result.migrationsExecuted)
                .as("프로브가 건너뛰어진다 — 그래서 위 테스트의 개수 단언이 판정으로 쓰인다")
                .isZero();
        try (Connection connection = connect(jdbcUrl)) {
            assertThat(scalar(connection, PROBE_COLUMN_COUNT)).isZero();
        }
    }

    /** fingerprint 비교가 프로브의 효과를 실제로 본다 — "같다" 가 빈 비교가 아님을 보인다. */
    @Test
    @DisplayName("반증 — fingerprint 비교가 마이그레이션 한 건의 차이를 잡는다")
    void fingerprintComparisonSeesTheMigration() throws Exception {
        String withProbe = baselinedDatabase("forward_diff_with");
        flywayFor(withProbe, probeLocation()).migrate();
        String withoutProbe = baselinedDatabase("forward_diff_without");
        flywayFor(withoutProbe).migrate();   // 커밋된 것까지는 똑같이 올린다

        try (Connection a = connect(withProbe); Connection b = connect(withoutProbe)) {
            List<String> applied = SchemaFingerprint.of(a);
            assertThat(applied).isNotEqualTo(SchemaFingerprint.of(b));
            assertThat(applied)
                    .as("차이가 우연이 아니라 프로브가 더한 그 컬럼이다")
                    .anyMatch(line -> line.startsWith("COLUMN users.forward_probe_at "));
        }
    }

    // ---- helpers ----

    /** dev·운영 재현: alembic 이 만들어 둔 스키마(=V1) 위에 baseline 기록만 남긴 DB. */
    private static String baselinedDatabase(String name) throws SQLException, IOException {
        String jdbcUrl = PostgresContainerSupport.createDatabase(name);
        applyRawBaseline(jdbcUrl);
        flywayFor(jdbcUrl).baseline();
        return jdbcUrl;
    }

    /** {@code version|description|type|checksum} — 이력의 모양을 그대로 본다. */
    private static List<String> historyRows(Connection connection) throws SQLException {
        try (Statement st = connection.createStatement();
                ResultSet rs = st.executeQuery(
                        "SELECT version, description, type, checksum FROM flyway_schema_history "
                                + "ORDER BY installed_rank")) {
            List<String> rows = new java.util.ArrayList<>();
            while (rs.next()) {
                Object checksum = rs.getObject(4);
                rows.add(rs.getString(1) + "|" + rs.getString(2) + "|" + rs.getString(3) + "|"
                        + (checksum == null ? "null" : checksum));
            }
            return rows;
        }
    }
}
