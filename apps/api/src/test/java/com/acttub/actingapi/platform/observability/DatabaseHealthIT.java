package com.acttub.actingapi.platform.observability;

import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.sql.DriverManager;
import java.time.Duration;

import com.acttub.actingapi.ActingApiApplication;
import com.acttub.actingapi.support.PostgresContainerSupport;
import com.acttub.actingapi.support.MonitoringFailureFixture;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.boot.web.servlet.context.ServletWebServerApplicationContext;

class DatabaseHealthIT {
    private static final HttpClient CLIENT = HttpClient.newHttpClient();

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void databaseOutageIsBoundedAndRecoversEvenWhenFailureReportingBlocksOrThrows(boolean reportingThrows) throws Exception {
        String database = PostgresContainerSupport.createDatabaseName("monitoring_database_outage_" + reportingThrows);
        try (var context = new SpringApplicationBuilder(ActingApiApplication.class, MonitoringFailureFixture.class)
                .properties("DATABASE_URL=" + PostgresContainerSupport.deployStyleUrl(database), "JWT_SECRET=test-secret")
                .run("--server.port=0", "--management.server.port=0", "--MONITORING_TOKEN=db-probe-test",
                        "--spring.datasource.hikari.connection-timeout=700");
             var admin = DriverManager.getConnection(PostgresContainerSupport.POSTGRES.getJdbcUrl(),
                     PostgresContainerSupport.POSTGRES.getUsername(), PostgresContainerSupport.POSTGRES.getPassword());
             var statement = admin.createStatement()) {
            int managementPort = context.getEnvironment().getRequiredProperty("local.management.port", Integer.class);
            int publicPort = ((ServletWebServerApplicationContext) context).getWebServer().getPort();
            var sink = context.getBean(MonitoringFailureFixture.Sink.class);
            sink.throwOnReport = reportingThrows;
            sink.release = new java.util.concurrent.CountDownLatch(reportingThrows ? 0 : 1);
            assertThat(get(managementPort, "/actuator/health/db").body()).isEqualTo("{\"status\":\"UP\"}");
            try {
                // Only this fixture database is disconnected; other tests share the PostgreSQL container.
                statement.execute("ALTER DATABASE " + database + " ALLOW_CONNECTIONS false");
                statement.execute("SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
                        + "WHERE datname = '" + database + "'");
                for (int attempt = 0; attempt < 2; attempt++) {
                    long started = System.nanoTime();
                    var down = get(managementPort, "/actuator/health/db");
                    assertThat(Duration.ofNanos(System.nanoTime() - started)).isLessThan(Duration.ofSeconds(3));
                    assertThat(down.statusCode()).isEqualTo(503);
                    assertThat(down.body()).isEqualTo("{\"status\":\"DOWN\"}");
                }
                var publicHealth = get(publicPort, "/health");
                assertThat(publicHealth.statusCode()).isEqualTo(200);
                assertThat(publicHealth.body()).contains("\"status\":\"ok\"");
                assertThat(get(managementPort, "/actuator/prometheus").statusCode()).isEqualTo(200);
                await().atMost(Duration.ofSeconds(3)).untilAsserted(() -> {
                    var reports = sink.at("DatabaseHealthIndicator.database");
                    assertThat(reports).isNotEmpty();
                    // Disconnect and pool-acquisition failures may have different wrapper types.
                    assertThat(reports).extracting(report -> report.cause().getClass()).doesNotHaveDuplicates();
                    assertThat(reports.getFirst().tags()).containsEntry("failure_kind", "external");
                    assertThat(reports.getFirst().cause()).isNotInstanceOf(java.util.concurrent.ExecutionException.class);
                    assertThat(FailureClassifier.classify(reports.getFirst().cause())).isEqualTo(FailureKind.EXTERNAL);
                });
            } finally {
                statement.execute("ALTER DATABASE " + database + " ALLOW_CONNECTIONS true");
                sink.release.countDown();
            }
            await().atMost(Duration.ofSeconds(8)).untilAsserted(() -> {
                var recovered = get(managementPort, "/actuator/health/db");
                assertThat(recovered.statusCode()).isEqualTo(200);
                assertThat(recovered.body()).isEqualTo("{\"status\":\"UP\"}");
            });
        }
    }

    private HttpResponse<String> get(int port, String path) throws Exception {
        return CLIENT.send(HttpRequest.newBuilder(URI.create("http://localhost:" + port + path))
                .timeout(Duration.ofSeconds(4)).header("Authorization", "Bearer db-probe-test").GET().build(),
                HttpResponse.BodyHandlers.ofString());
    }
}
