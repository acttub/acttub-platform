package com.acttub.actingapi.flyway;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.Arrays;
import java.util.List;

import com.acttub.actingapi.support.PostgresContainerSupport;
import org.flywaydb.core.Flyway;
import org.springframework.jdbc.datasource.SimpleDriverDataSource;

/**
 * Flyway 테스트 둘이 함께 쓰는 배관.
 *
 * <p>{@link FlywayBaselineTest} 는 <b>지금 서 있는 자리</b>(V1 로 세운 스키마 · baseline 기록)를,
 * {@link FlywayForwardMigrationTest} 는 <b>거기서 앞으로 가는 길</b>(V2 이후)을 본다. 두 테스트가
 * 같은 두 경로를 세워야 해서 여기 모았다.
 */
final class FlywaySupport {

    private FlywaySupport() {
    }

    /**
     * 배포와 같은 설정.
     *
     * <p>⚠ <b>baseline 관련 값을 주지 않는다.</b> {@code application.yml} 이 {@code baseline-version}
     * ·{@code baseline-description} 을 설정하지 않으므로 dev·운영에 실제로 찍힌 이력은 Flyway
     * 기본값({@code 1} · {@code << Flyway Baseline >>})이다. 여기서 값을 명시하면 실물과 다른 DB 를
     * 세워 놓고 "경로 A 재현" 이라고 부르게 된다 — 실제로 {@code baselineDescription("baseline")} 을
     * 주고 있었고, {@code FlywayForwardMigrationTest} 의 이력 단언이 그것을 잡았다.
     */
    static Flyway flywayFor(String jdbcUrl, String... extraLocations) {
        String[] locations = new String[extraLocations.length + 1];
        locations[0] = "classpath:db/migration";
        System.arraycopy(extraLocations, 0, locations, 1, extraLocations.length);
        return Flyway.configure()
                .dataSource(dataSource(jdbcUrl))
                .locations(locations)
                .load();
    }

    static SimpleDriverDataSource dataSource(String jdbcUrl) {
        SimpleDriverDataSource ds = new SimpleDriverDataSource();
        ds.setDriverClass(org.postgresql.Driver.class);
        ds.setUrl(jdbcUrl);
        ds.setUsername(PostgresContainerSupport.POSTGRES.getUsername());
        ds.setPassword(PostgresContainerSupport.POSTGRES.getPassword());
        return ds;
    }

    /**
     * classpath 에 커밋된 마이그레이션의 버전 목록.
     *
     * <p>🔥 <b>개수도 버전도 손으로 박지 않는다.</b> 박아 두면 첫 {@code V2__} 가 들어오는 순간
     * 이 테스트들이 깨지는데, 그 실패는 스키마 드리프트가 아니라 <b>검사 자신이 낡은 것</b>이다.
     * 3단계의 목적이 "스키마 변경이 Flyway 마이그레이션으로 들어간다" 인데 그 첫 변경을 관문이
     * 막아서면 안 된다.
     */
    static synchronized List<String> committedVersions() {
        if (COMMITTED == null) {
            String probe = PostgresContainerSupport.createDatabase("flyway_scan");
            COMMITTED = Arrays.stream(flywayFor(probe).info().all())
                    .map(info -> info.getVersion().getVersion())
                    .toList();
        }
        return COMMITTED;
    }

    private static List<String> COMMITTED;

    static int committedCount() {
        return committedVersions().size();
    }

    /**
     * 커밋된 최대 버전 + 1 — 테스트용 프로브가 실물 마이그레이션과 버전 충돌하지 않게 한다.
     * 충돌하면 Flyway 는 {@code Found more than one migration with version N} 으로 죽는다.
     */
    static String nextFreeVersion() {
        int max = 0;
        for (String version : committedVersions()) {
            try {
                max = Math.max(max, Integer.parseInt(version));
            } catch (NumberFormatException exc) {
                throw new IllegalStateException(
                        "마이그레이션 버전은 정수여야 한다 (V2__… 규약, db/migration/README.md): "
                                + version, exc);
            }
        }
        return String.valueOf(max + 1);
    }

    static Connection connect(String jdbcUrl) throws SQLException {
        return DriverManager.getConnection(jdbcUrl,
                PostgresContainerSupport.POSTGRES.getUsername(),
                PostgresContainerSupport.POSTGRES.getPassword());
    }

    /**
     * 임시 디렉토리를 Flyway 위치로. 커밋하지 않을 마이그레이션을 얹을 때 쓴다.
     *
     * <p>설정 자체는 부르는 쪽이 만든다 — 이 위치를 쓰는 셋이 모두 <b>일부러 다른 설정</b>이고
     * (classpath 포함 여부 · baselineVersion), 그 차이가 각 반증의 내용이라 묶으면 흐려진다.
     */
    static String locationOf(Path directory) {
        return "filesystem:" + directory.toAbsolutePath();
    }

    static long scalar(Connection connection, String sql) throws SQLException {
        try (Statement st = connection.createStatement(); ResultSet rs = st.executeQuery(sql)) {
            rs.next();
            return rs.getLong(1);
        }
    }

    /** {@code V1__baseline.sql} 의 원문. */
    static String baselineSql() throws IOException {
        try (InputStream in = FlywaySupport.class
                .getResourceAsStream("/db/migration/V1__baseline.sql")) {
            if (in == null) {
                throw new IllegalStateException("V1__baseline.sql not on the classpath");
            }
            return new String(in.readAllBytes(), StandardCharsets.UTF_8);
        }
    }

    /**
     * Flyway 를 거치지 않고 V1 을 그대로 실행한다 — <b>dev·운영의 현 상태 재현</b>이다.
     *
     * <p>그 DB 들은 alembic 이 스키마를 만들었고 {@code flyway_schema_history} 가 없다. 여기서
     * alembic 대신 V1 을 쓰는 근거는 <b>1단계 재해복구 리허설의 실측</b>이다 — 두 경로를 독립
     * 생성해 fingerprint · owner · ACL · extension · sequence · 시드 실제 값 7종이 전부 같음을
     * 확인했다({@code spec/M6-findings.md}).
     *
     * <p>⚠ <b>실행 시점에 그것을 재확인하는 검사는 이제 없고, 다시 만들 수도 없다.</b> 3단계
     * 전에는 {@code FlywayBaselineTest} 가 alembic 을 직접 돌려 대조했지만 alembic 이 더 이상
     * 전진하지 않아 그 테스트를 지웠고, 5단계가 파이썬 트리와 리허설 스크립트를 함께 지우면서
     * <b>대조 상대 자체가 저장소에서 사라졌다.</b> 이 fixture 가 V1 이 만드는 스키마의 유일한
     * 기준이고, 그것이 옳다는 근거는 위 두 문서에 적힌 <b>당시의 실측</b>뿐이다.
     */
    static void applyRawBaseline(String jdbcUrl) throws SQLException, IOException {
        try (Connection connection = connect(jdbcUrl); Statement st = connection.createStatement()) {
            st.execute(baselineSql());
        }
    }
}
