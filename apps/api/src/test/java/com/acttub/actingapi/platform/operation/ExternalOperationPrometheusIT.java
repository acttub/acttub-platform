package com.acttub.actingapi.platform.operation;

import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;

import com.acttub.actingapi.ActingApiApplication;
import com.acttub.actingapi.support.PostgresContainerSupport;
import org.junit.jupiter.api.Test;
import org.springframework.boot.builder.SpringApplicationBuilder;

class ExternalOperationPrometheusIT {
    @Test
    void startupExposesZeroCountersAndBoundedDurationBucketsOverTheManagementHttpEndpoint() throws Exception {
        String url = PostgresContainerSupport.deployStyleUrl(
                PostgresContainerSupport.createDatabaseName("operation_prometheus"));
        try (var app = new SpringApplicationBuilder(ActingApiApplication.class)
                .properties("DATABASE_URL=" + url, "JWT_SECRET=test-secret")
                .run("--server.port=0", "--management.server.port=0", "--MONITORING_TOKEN=operation-test",
                        "--ANALYSIS_WORKER_ENABLED=false")) {
            int port = app.getEnvironment().getRequiredProperty("local.management.port", Integer.class);
            try (HttpClient client = HttpClient.newHttpClient()) {
                var response = client.send(HttpRequest.newBuilder(
                                URI.create("http://localhost:" + port + "/actuator/prometheus"))
                        .header("Authorization", "Bearer operation-test").GET().build(),
                        HttpResponse.BodyHandlers.ofString());
                assertThat(response.statusCode()).isEqualTo(200);
                String body = response.body();
                for (String metric : new String[] {"accepted", "attempts", "requeues", "terminal", "external_calls"}) {
                    assertThat(body.lines().filter(line -> line.startsWith("acttub_external_operations_" + metric + "_total{")))
                            .isNotEmpty().allMatch(line -> line.endsWith(" 0.0") || line.endsWith(" 0"));
                }
                for (String timer : new String[] {"wait", "execution", "elapsed"}) {
                    assertThat(body).contains("acttub_external_operations_" + timer + "_seconds_bucket{");
                }
                assertThat(body).contains("acttub_external_operations_unmeasured{");
                assertThat(body).doesNotContain("operation_id=", "session_id=", "user_id=", "lease_token=");
                java.util.concurrent.Callable<Double> snapshotTime = () -> {
                    var current = client.send(HttpRequest.newBuilder(
                                    URI.create("http://localhost:" + port + "/actuator/prometheus"))
                            .timeout(Duration.ofSeconds(2)).header("Authorization", "Bearer operation-test").GET().build(),
                            HttpResponse.BodyHandlers.ofString());
                    assertThat(current.statusCode()).isEqualTo(200);
                    String sample = current.body().lines().filter(line -> line.startsWith(
                            "acttub_external_operations_snapshot_timestamp_seconds{")).findFirst().orElseThrow();
                    return Double.parseDouble(sample.substring(sample.lastIndexOf(' ') + 1));
                };
                await().atMost(Duration.ofSeconds(3)).untilAsserted(() -> assertThat(snapshotTime.call()).isPositive());
                double first = snapshotTime.call();
                // Internal DB refresh has a five-second delay plus a two-second query budget.
                // It is independent of the external Prometheus scrape interval (30 seconds).
                await().atMost(Duration.ofSeconds(8)).untilAsserted(() -> assertThat(snapshotTime.call()).isGreaterThan(first));
            }
        }
    }
}
