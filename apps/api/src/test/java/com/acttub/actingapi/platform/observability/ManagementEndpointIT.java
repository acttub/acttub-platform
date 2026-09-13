package com.acttub.actingapi.platform.observability;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.URI;
import java.net.ServerSocket;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.List;

import com.acttub.actingapi.ActingApiApplication;
import com.acttub.actingapi.support.PostgresContainerSupport;
import org.junit.jupiter.api.Test;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.boot.web.servlet.context.ServletWebServerApplicationContext;

/** Real sockets and PostgreSQL: monitoring credentials must never grant public API access. */
class ManagementEndpointIT {
    private static final String TOKEN = "integration-monitoring-token";
    private static final HttpClient CLIENT = HttpClient.newHttpClient();

    @Test
    void onlyAuthenticatedMonitoringPathsAreAvailableOnTheManagementPort() throws Exception {
        String databaseUrl = PostgresContainerSupport.deployStyleUrl(
                PostgresContainerSupport.createDatabaseName("management_endpoint"));
        try (var context = new SpringApplicationBuilder(ActingApiApplication.class)
                .properties("DATABASE_URL=" + databaseUrl, "JWT_SECRET=test-secret")
                .run("--server.port=0", "--management.server.port=0", "--MONITORING_TOKEN=" + TOKEN,
                        "--server.forward-headers-strategy=framework",
                        "--MONITORING_ENVIRONMENT=untrusted-sensitive-environment")) {
            int publicPort = ((ServletWebServerApplicationContext) context).getWebServer().getPort();
            Integer managementPort = context.getEnvironment().getProperty("local.management.port", Integer.class);
            assertThat(managementPort).as("separate management listener").isNotNull().isNotEqualTo(publicPort);

            for (String path : List.of("/actuator/prometheus", "/actuator/health/db")) {
                assertThat(get(managementPort, path, null).statusCode()).as(path).isEqualTo(401);
                assertThat(get(managementPort, path, "Bearer wrong").statusCode()).as(path).isEqualTo(401);
                assertThat(get(managementPort, path, "Bearer " + TOKEN).statusCode()).as(path).isEqualTo(200);
                assertThat(get(publicPort, path, "Bearer " + TOKEN).statusCode()).as(path).isEqualTo(404);
                HttpResponse<String> spoofed = CLIENT.send(HttpRequest.newBuilder(
                                URI.create("http://localhost:" + publicPort + path))
                        .header("Authorization", "Bearer " + TOKEN)
                        .header("Forwarded", "host=localhost:" + managementPort + ";proto=https")
                        .header("X-Forwarded-Port", managementPort.toString()).GET().build(),
                        HttpResponse.BodyHandlers.ofString());
                assertThat(spoofed.statusCode()).as("forwarded " + path).isEqualTo(404);
            }
            for (String path : List.of("/health", "/v2/consents/documents", "/v3/api-docs",
                    "/actuator", "/actuator/health", "/actuator/env", "/actuator/health/db/extra")) {
                assertThat(get(managementPort, path, "Bearer " + TOKEN).statusCode()).as(path).isEqualTo(404);
            }
            assertThat(get(managementPort, "/actuator/health/db", "Bearer " + TOKEN).body())
                    .isEqualTo("{\"status\":\"UP\"}");
            assertThat(get(managementPort, "/actuator/prometheus", "Bearer " + TOKEN).body())
                    .contains("environment=\"local\"").doesNotContain("untrusted-sensitive-environment");
            assertThat(get(publicPort, "/health", "Bearer " + TOKEN).statusCode()).isEqualTo(200);
            var rejected = get(publicPort, "/v2/auth/me", "Bearer " + TOKEN);
            assertThat(rejected.statusCode()).isEqualTo(401);
            assertThat(rejected.body()).isEqualTo("{\"detail\":\"invalid or missing access token\"}");
        }
    }

    @Test
    void emptyTokenDeniesMonitoringWithoutPreventingApplicationBoot() throws Exception {
        String databaseUrl = PostgresContainerSupport.deployStyleUrl(
                PostgresContainerSupport.createDatabaseName("management_empty_token"));
        try (var context = new SpringApplicationBuilder(ActingApiApplication.class)
                .properties("DATABASE_URL=" + databaseUrl, "JWT_SECRET=test-secret")
                .run("--server.port=0", "--management.server.port=0", "--MONITORING_TOKEN=")) {
            int managementPort = context.getEnvironment().getRequiredProperty("local.management.port", Integer.class);
            int publicPort = ((ServletWebServerApplicationContext) context).getWebServer().getPort();
            for (String path : List.of("/actuator/prometheus", "/actuator/health/db")) {
                assertThat(get(managementPort, path, null).statusCode()).isEqualTo(401);
                assertThat(get(managementPort, path, "Bearer ").statusCode()).isEqualTo(401);
                assertThat(get(managementPort, path, "Bearer " + TOKEN).statusCode()).isEqualTo(401);
            }
            assertThat(get(publicPort, "/health", null).statusCode()).isEqualTo(200);
        }
    }

    @Test
    void defaultBootHasNoManagementListenerEvenWithAToken() throws Exception {
        String databaseUrl = PostgresContainerSupport.deployStyleUrl(
                PostgresContainerSupport.createDatabaseName("management_disabled"));
        try (var context = new SpringApplicationBuilder(ActingApiApplication.class)
                .properties("DATABASE_URL=" + databaseUrl, "JWT_SECRET=test-secret")
                .run("--server.port=0", "--MONITORING_TOKEN=" + TOKEN)) {
            int publicPort = ((ServletWebServerApplicationContext) context).getWebServer().getPort();
            assertThat(context.getEnvironment().getProperty("local.management.port")).isNull();
            assertThat(get(publicPort, "/health", null).statusCode()).isEqualTo(200);
            for (String path : List.of("/actuator/prometheus", "/actuator/health/db")) {
                assertThat(get(publicPort, path, "Bearer " + TOKEN).statusCode()).isEqualTo(404);
            }
        }
    }

    @Test
    void publicListenerRemainsClosedToActuatorWhenManagementUsesTheSamePort() throws Exception {
        int publicPort;
        try (var availablePort = new ServerSocket(0)) {
            publicPort = availablePort.getLocalPort();
        }
        String databaseUrl = PostgresContainerSupport.deployStyleUrl(
                PostgresContainerSupport.createDatabaseName("management_same_port"));
        try (var context = new SpringApplicationBuilder(ActingApiApplication.class)
                .properties("DATABASE_URL=" + databaseUrl, "JWT_SECRET=test-secret")
                .run("--server.port=" + publicPort, "--management.server.port=" + publicPort,
                        "--MONITORING_TOKEN=" + TOKEN, "--server.forward-headers-strategy=framework")) {
            for (String path : List.of("/actuator/prometheus", "/actuator/health/db")) {
                assertThat(get(publicPort, path, "Bearer " + TOKEN).statusCode()).isEqualTo(404);
                for (boolean authenticated : List.of(false, true)) {
                    var request = HttpRequest.newBuilder(URI.create("http://localhost:" + publicPort + path))
                            .header("X-Forwarded-Prefix", "/proxy-prefix").GET();
                    if (authenticated) request.header("Authorization", "Bearer " + TOKEN);
                    assertThat(CLIENT.send(request.build(), HttpResponse.BodyHandlers.ofString()).statusCode())
                            .as("same port and forwarded prefix, authenticated=" + authenticated).isEqualTo(404);
                }
            }
        }
    }

    private static HttpResponse<String> get(int port, String path, String authorization) throws Exception {
        var request = HttpRequest.newBuilder(URI.create("http://localhost:" + port + path))
                .timeout(Duration.ofSeconds(10)).GET();
        if (authorization != null) request.header("Authorization", authorization);
        return CLIENT.send(request.build(), HttpResponse.BodyHandlers.ofString());
    }
}
