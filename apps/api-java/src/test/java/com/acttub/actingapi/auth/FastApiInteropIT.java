package com.acttub.actingapi.auth;

import static java.nio.charset.StandardCharsets.UTF_8;
import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.TimeUnit;

import com.acttub.actingapi.support.AlembicSchema;
import com.acttub.actingapi.support.PostgresContainerSupport;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.transaction.support.TransactionTemplate;

/** 실행 중 FastAPI와 shared DB를 쓰는 M5 rollback 관문. */
class FastApiInteropIT {
    private static final String JWT_SECRET = "M2-롤백-호환-비밀-🔐";
    private static final Duration STARTUP_TIMEOUT = Duration.ofSeconds(60);
    private static final Duration REQUEST_TIMEOUT = Duration.ofSeconds(10);
    private static final Duration SHUTDOWN_TIMEOUT = Duration.ofSeconds(10);
    private static final ObjectMapper JSON = new ObjectMapper();

    @TempDir
    Path tempDirectory;

    @Test
    @Timeout(value = 7, unit = TimeUnit.MINUTES)
    void javaAccessAndRefreshTokensAreAcceptedByRunningFastApi() throws Exception {
        requireOrSkipAlembic();

        String databaseName = "fastapi_interop_"
                + UUID.randomUUID().toString().replace("-", "").substring(0, 12);
        String jdbcUrl = AlembicSchema.materializeDatabase(databaseName);
        int port = freeLoopbackPort();
        Path logFile = tempDirectory.resolve("fastapi.log");
        Process fastApi = startFastApi(databaseName, port, logFile);

        try {
            HttpClient http = HttpClient.newBuilder()
                    .connectTimeout(Duration.ofSeconds(2))
                    .build();
            URI baseUri = URI.create("http://127.0.0.1:" + port);
            awaitHealthy(http, baseUri, fastApi, logFile);

            DriverManagerDataSource dataSource = new DriverManagerDataSource(
                    jdbcUrl,
                    PostgresContainerSupport.POSTGRES.getUsername(),
                    PostgresContainerSupport.POSTGRES.getPassword());
            JdbcTemplate jdbc = new JdbcTemplate(dataSource);
            AuthStore store = new AuthStore(
                    jdbc,
                    new TransactionTemplate(new DataSourceTransactionManager(dataSource)));
            JwtService jwt = new JwtService(JWT_SECRET, Clock.systemUTC(), JSON);

            UUID userId = UUID.randomUUID();
            jdbc.update(
                    "INSERT INTO users(id,email,nickname,status) "
                            + "VALUES (?,?,?,'active'::user_status_t)",
                    userId,
                    "fastapi-interop-" + userId + "@example.test",
                    "rollback-user");

            Instant issuedAt = Instant.now();
            JwtService.IssuedToken access = jwt.issueAccessToken(userId);
            JwtService.IssuedToken refresh = jwt.issueRefreshToken(userId);
            JwtService.IssuedToken independentSession = jwt.issueRefreshToken(userId);
            store.issueRefresh(
                    userId,
                    JwtService.hashToken(refresh.value()),
                    refresh.expiresAt(),
                    "java-primary-session",
                    issuedAt);
            store.issueRefresh(
                    userId,
                    JwtService.hashToken(independentSession.value()),
                    independentSession.expiresAt(),
                    "java-independent-session",
                    issuedAt);

            HttpResponse<String> protectedResponse = http.send(
                    HttpRequest.newBuilder(baseUri.resolve("/v2/me"))
                            .timeout(REQUEST_TIMEOUT)
                            .header("Authorization", "Bearer " + access.value())
                            .GET()
                            .build(),
                    HttpResponse.BodyHandlers.ofString(UTF_8));
            assertThat(protectedResponse.statusCode())
                    .withFailMessage("Java access token을 FastAPI가 거부했다: %s",
                            protectedResponse.body())
                    .isEqualTo(200);
            assertThat(JSON.readTree(protectedResponse.body()).path("id").textValue())
                    .isEqualTo(userId.toString());

            HttpResponse<String> rotated = postRefresh(http, baseUri, refresh.value());
            assertThat(rotated.statusCode())
                    .withFailMessage("Java refresh token을 FastAPI가 거부했다: %s", rotated.body())
                    .isEqualTo(200);
            JsonNode pair = JSON.readTree(rotated.body());
            assertThat(pair.path("access_token").textValue()).isNotBlank();
            String replacementRefresh = pair.path("refresh_token").textValue();
            assertThat(replacementRefresh)
                    .isNotBlank()
                    .isNotEqualTo(refresh.value());
            assertThat(pair.path("token_type").textValue()).isEqualTo("bearer");

            Long sessionsBeforeReplay = jdbc.queryForObject(
                    "SELECT count(*) FROM refresh_tokens WHERE user_id=?",
                    Long.class,
                    userId);
            Long activeBeforeReplay = jdbc.queryForObject(
                    "SELECT count(*) FROM refresh_tokens "
                            + "WHERE user_id=? AND revoked_at IS NULL "
                            + "AND token_hash IN (?,?)",
                    Long.class,
                    userId,
                    JwtService.hashToken(independentSession.value()),
                    JwtService.hashToken(replacementRefresh));
            assertThat(sessionsBeforeReplay)
                    .as("원본, 독립 Java session, FastAPI replacement가 모두 저장돼야 한다")
                    .isEqualTo(3L);
            assertThat(activeBeforeReplay)
                    .as("재사용 전에는 독립 Java session과 FastAPI replacement가 활성 상태여야 한다")
                    .isEqualTo(2L);

            HttpResponse<String> replayed = postRefresh(http, baseUri, refresh.value());
            assertThat(replayed.statusCode())
                    .withFailMessage("소진 refresh token 재사용이 거부되지 않았다: %s", replayed.body())
                    .isEqualTo(401);
            assertThat(JSON.readTree(replayed.body()))
                    .isEqualTo(JSON.readTree("{\"detail\":\"invalid_refresh_token\"}"));

            Long totalSessions = jdbc.queryForObject(
                    "SELECT count(*) FROM refresh_tokens WHERE user_id=?",
                    Long.class,
                    userId);
            Long activeSessions = jdbc.queryForObject(
                    "SELECT count(*) FROM refresh_tokens WHERE user_id=? AND revoked_at IS NULL",
                    Long.class,
                    userId);
            assertThat(totalSessions)
                    .as("재사용이 새 token을 만들지 않아야 한다")
                    .isEqualTo(3L);
            assertThat(activeSessions)
                    .as("소진 token 재사용은 해당 사용자의 모든 refresh session을 revoke해야 한다")
                    .isZero();
        } finally {
            stop(fastApi);
        }
    }

    private Process startFastApi(String databaseName, int port, Path logFile) throws IOException {
        Path apiWorkspace = AlembicSchema.apiRoot().getParent();
        ProcessBuilder builder = new ProcessBuilder(
                "uv",
                "run",
                "--directory",
                apiWorkspace.toString(),
                "uvicorn",
                "acting_api.app:create_app",
                "--factory",
                "--host",
                "127.0.0.1",
                "--port",
                Integer.toString(port));
        builder.redirectErrorStream(true);
        builder.redirectOutput(logFile.toFile());
        Map<String, String> environment = builder.environment();
        for (String optional : List.of(
                "S3_BUCKET",
                "AWS_REGION",
                "AWS_ACCESS_KEY_ID",
                "AWS_SECRET_ACCESS_KEY",
                "KEEP_ALIVE_URL",
                "STATIC_DIR",
                "ADMIN_OPS_TOKEN",
                "CONSENT_DOCS_DIR")) {
            // config.py가 로컬 .env를 읽어도 외부 서비스나 로컬 경로가 이 테스트에 섞이지 않는다.
            environment.put(optional, "");
        }
        environment.put("DATABASE_URL", PostgresContainerSupport.deployStyleUrl(databaseName));
        environment.put("JWT_SECRET", JWT_SECRET);
        environment.put("DEVELOPMENT_AUTH_PROVIDER", "1");
        environment.put("GEMINI_API_KEY", "fastapi-interop-not-a-real-key");
        environment.put("GEMINI_MODEL", "fastapi-interop-model");
        environment.put("PYTHONUNBUFFERED", "1");
        return builder.start();
    }

    private static HttpResponse<String> postRefresh(
            HttpClient http,
            URI baseUri,
            String refreshToken) throws IOException, InterruptedException {
        String requestBody = JSON.writeValueAsString(Map.of("refresh_token", refreshToken));
        return http.send(
                HttpRequest.newBuilder(baseUri.resolve("/v2/auth/refresh"))
                        .timeout(REQUEST_TIMEOUT)
                        .header("Content-Type", "application/json")
                        .POST(HttpRequest.BodyPublishers.ofString(requestBody, UTF_8))
                        .build(),
                HttpResponse.BodyHandlers.ofString(UTF_8));
    }

    private static void awaitHealthy(
            HttpClient http,
            URI baseUri,
            Process process,
            Path logFile) throws Exception {
        Instant deadline = Instant.now().plus(STARTUP_TIMEOUT);
        HttpRequest health = HttpRequest.newBuilder(baseUri.resolve("/health"))
                .timeout(Duration.ofSeconds(2))
                .GET()
                .build();
        Throwable lastFailure = null;
        while (Instant.now().isBefore(deadline)) {
            if (!process.isAlive()) {
                throw new AssertionError(
                        "FastAPI가 health 확인 전에 종료됐다 (exit " + process.exitValue() + ")\n"
                                + readLog(logFile));
            }
            try {
                HttpResponse<String> response = http.send(
                        health,
                        HttpResponse.BodyHandlers.ofString(UTF_8));
                if (response.statusCode() == 200) {
                    return;
                }
                lastFailure = new IllegalStateException(
                        "health status=" + response.statusCode() + " body=" + response.body());
            } catch (IOException exception) {
                lastFailure = exception;
            }
            Thread.sleep(200);
        }
        throw new AssertionError(
                "FastAPI /health가 " + STARTUP_TIMEOUT + " 안에 준비되지 않았다\n"
                        + readLog(logFile),
                lastFailure);
    }

    private static int freeLoopbackPort() throws IOException {
        try (ServerSocket socket = new ServerSocket(
                0,
                50,
                InetAddress.getByName("127.0.0.1"))) {
            return socket.getLocalPort();
        }
    }

    private static void stop(Process process) {
        if (!process.isAlive()) {
            return;
        }
        process.destroy();
        try {
            if (!process.waitFor(SHUTDOWN_TIMEOUT.toSeconds(), TimeUnit.SECONDS)) {
                process.destroyForcibly();
                process.waitFor(SHUTDOWN_TIMEOUT.toSeconds(), TimeUnit.SECONDS);
            }
        } catch (InterruptedException exception) {
            process.destroyForcibly();
            Thread.currentThread().interrupt();
        }
    }

    private static String readLog(Path logFile) {
        try {
            String log = Files.readString(logFile, UTF_8);
            int maximum = 12_000;
            return log.length() <= maximum ? log : log.substring(log.length() - maximum);
        } catch (IOException exception) {
            return "<FastAPI log를 읽을 수 없음: " + exception.getMessage() + ">";
        }
    }

    private static void requireOrSkipAlembic() {
        if (AlembicSchema.isAvailable()) {
            return;
        }
        if (AlembicSchema.isRequired()) {
            throw new IllegalStateException(
                    "REQUIRE_ALEMBIC_CHECK=1 인데 FastAPI interop을 실행할 수 없다 "
                            + "(uv가 PATH에 없거나 " + AlembicSchema.apiRoot() + "가 제자리에 없다)");
        }
        Assumptions.abort("uv가 없어 FastAPI interop을 건너뛴다 "
                + "(REQUIRE_ALEMBIC_CHECK=1을 주면 실패로 바꾼다)");
    }
}
