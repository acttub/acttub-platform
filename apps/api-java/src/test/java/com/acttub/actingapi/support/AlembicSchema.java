package com.acttub.actingapi.support;

import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.util.List;
import java.util.concurrent.TimeUnit;

/**
 * {@code apps/api} 의 alembic 을 <b>실행 시점에</b> 돌려 스키마 fingerprint 를 뜬다.
 *
 * <p>왜 필요한가: {@code alembic-schema-fingerprint.txt} 와 {@code V1__baseline.sql} 은 둘 다
 * alembic 결과의 스냅샷이다. 이 둘을 서로 비교하면 <b>둘이 같이 낡아도 초록이 뜬다</b> —
 * dev 가 {@code 0006 → 0010} 으로 전진하는 동안 실제로 그렇게 됐다. 기대값을 파일이 아니라
 * <b>지금 이 순간의 alembic HEAD</b> 에서 뽑아야 그 구멍이 막힌다.
 *
 * <p>{@code uv} 가 없거나 파이썬 워크스페이스가 동기화되지 않은 환경에서는 돌 수 없다.
 * 그런 곳에서는 {@link #isAvailable()} 이 {@code false} 를 주고 호출자가 건너뛴다.
 * 다만 <b>{@code REQUIRE_ALEMBIC_CHECK=1} 이면 건너뛰지 않고 실패한다</b> — CI 는 이 값을 켠다.
 * 건너뛰기가 조용한 초록으로 되돌아가는 것을 막는 장치다.
 */
public final class AlembicSchema {

    /** alembic 은 컨테이너 기동 + 10개 리비전이라 넉넉히 준다. */
    private static final long TIMEOUT_SECONDS = 300;

    private AlembicSchema() {
    }

    /** {@code apps/api/acting-api} — Gradle 테스트의 작업 디렉토리는 {@code apps/api-java} 다. */
    public static Path apiRoot() {
        return Path.of("..", "api", "acting-api").toAbsolutePath().normalize();
    }

    public static boolean isRequired() {
        return "1".equals(System.getenv("REQUIRE_ALEMBIC_CHECK"));
    }

    /** uv 가 PATH 에 있고 alembic 디렉토리가 제자리에 있는가. */
    public static boolean isAvailable() {
        return Files.isDirectory(apiRoot().resolve("alembic")) && uvExecutable() != null;
    }

    /**
     * 컨테이너 안에 빈 DB 를 만들고 {@code alembic upgrade head} 를 돌린 뒤 fingerprint 를 준다.
     *
     * @param databaseName 만들 DB 이름
     */
    public static List<String> materializeFingerprint(String databaseName) {
        materializeDatabase(databaseName);
        try (Connection connection = DriverManager.getConnection(
                PostgresContainerSupport.jdbcUrlFor(databaseName),
                PostgresContainerSupport.POSTGRES.getUsername(),
                PostgresContainerSupport.POSTGRES.getPassword())) {
            return SchemaFingerprint.of(connection);
        } catch (SQLException exc) {
            throw new IllegalStateException("failed to read the alembic schema fingerprint", exc);
        }
    }

    /** 빈 DB를 만든 뒤 현재 alembic HEAD까지 올리고 JDBC URL을 돌려준다. */
    public static String materializeDatabase(String databaseName) {
        PostgresContainerSupport.createDatabase(databaseName);
        upgradeHead(databaseName);
        return PostgresContainerSupport.jdbcUrlFor(databaseName);
    }

    private static void upgradeHead(String databaseName) {
        String uv = uvExecutable();
        if (uv == null) {
            throw new IllegalStateException("uv is not on PATH — cannot run alembic");
        }
        ProcessBuilder builder = new ProcessBuilder(
                uv, "run", "--no-sync", "alembic", "upgrade", "head");
        builder.directory(apiRoot().toFile());
        builder.redirectErrorStream(true);
        // DATABASE_URL 은 배포와 같은 postgresql:// 형태다. config 가 .env 없이도 뜨도록
        // JWT_SECRET 더미를 함께 준다 (ci.yml 의 api 잡과 같은 방식).
        builder.environment().put("DATABASE_URL",
                PostgresContainerSupport.deployStyleUrl(databaseName));
        builder.environment().put("JWT_SECRET", "alembic-fingerprint-not-a-real-key");

        try {
            Process process = builder.start();
            String output;
            try (var in = process.getInputStream()) {
                output = new String(in.readAllBytes(), StandardCharsets.UTF_8);
            }
            if (!process.waitFor(TIMEOUT_SECONDS, TimeUnit.SECONDS)) {
                process.destroyForcibly();
                throw new IllegalStateException("alembic upgrade head timed out\n" + output);
            }
            if (process.exitValue() != 0) {
                throw new IllegalStateException(
                        "alembic upgrade head failed (exit " + process.exitValue() + ")\n" + output);
            }
        } catch (IOException exc) {
            throw new IllegalStateException("failed to launch alembic", exc);
        } catch (InterruptedException exc) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("interrupted while running alembic", exc);
        }
    }

    private static String uvExecutable() {
        String path = System.getenv("PATH");
        if (path == null) {
            return null;
        }
        for (String entry : path.split(File.pathSeparator)) {
            File candidate = new File(entry, "uv");
            if (candidate.canExecute()) {
                return candidate.getAbsolutePath();
            }
        }
        return null;
    }
}
