package com.acttub.actingapi.platform.observability;

import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

import javax.sql.DataSource;

import com.acttub.actingapi.ActingApiApplication;
import com.acttub.actingapi.feature.auth.app.JwtService;
import com.acttub.actingapi.feature.coach.adapter.db.CoachStorageFixtures;
import com.acttub.actingapi.integration.llm.GeneratedText;
import com.acttub.actingapi.integration.llm.TextGenerator;
import com.acttub.actingapi.integration.llm.TokenUsage;
import com.acttub.actingapi.support.AccountFixtures;
import com.acttub.actingapi.support.DefaultClientHeader;
import com.acttub.actingapi.support.PostgresContainerSupport;
import io.micrometer.core.instrument.MockClock;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;
import org.junit.jupiter.api.TestMethodOrder;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.web.server.servlet.context.ServletWebServerApplicationContext;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.jdbc.core.JdbcTemplate;

@TestInstance(TestInstance.Lifecycle.PER_CLASS)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class HttpMonitoringIT {
    private static final HttpClient CLIENT = HttpClient.newHttpClient();
    private static final String TOKEN = "http-monitoring-secret";
    private ConfigurableApplicationContext context;
    private int port;
    private int managementPort;
    private JdbcTemplate jdbc;
    private CoachStorageFixtures fixtures;

    @BeforeAll
    void start() {
        String databaseUrl = PostgresContainerSupport.deployStyleUrl(
                PostgresContainerSupport.createDatabaseName("http_monitoring"));
        context = new SpringApplicationBuilder(ActingApiApplication.class, GeneratorFixture.class)
                .properties("DATABASE_URL=" + databaseUrl, "JWT_SECRET=test-secret")
                .run("--server.port=0", "--management.server.port=0", "--MONITORING_TOKEN=" + TOKEN,
                        "--MONITORING_ENVIRONMENT=dev");
        port = ((ServletWebServerApplicationContext) context).getWebServer().getPort();
        managementPort = context.getEnvironment().getRequiredProperty("local.management.port", Integer.class);
        jdbc = context.getBean(JdbcTemplate.class);
        jdbc.execute("TRUNCATE TABLE users, consent_documents RESTART IDENTITY CASCADE");
        fixtures = new CoachStorageFixtures(jdbc);
    }

    @AfterAll
    void stop() {
        if (context != null) context.close();
    }

    @Test
    @Order(1)
    void firstErrorBurstIsCountedFromPreinitializedAggregateSamples() throws Exception {
        String before = scrape();
        var initial = before.lines().filter(line -> line.startsWith("acttub_http_requests_total{")).toList();
        assertThat(initial).hasSize(12).allMatch(line -> line.endsWith(" 0.0") || line.endsWith(" 0"));
        for (String status : List.of("1xx", "2xx", "3xx", "4xx", "5xx", "other")) {
            for (String latency : List.of("ordinary", "long_running")) {
                assertThat(metric(before, "acttub_http_requests_total", "status_class=\"" + status + "\"",
                        "latency_class=\"" + latency + "\"", "environment=\"dev\"", "service=\"acting-api\""))
                        .isZero();
            }
        }
        UUID user = fixtures.insertUser();
        AccountFixtures.completeProfile(jdbc, user);
        String bearer = "Bearer " + context.getBean(JwtService.class).issueAccessToken(user).value();
        UUID practice = currentPractice(user);
        for (int i = 0; i < 3; i++) {
            UUID request = UUID.randomUUID();
            var response = post("/v2/coach/start", bearer, request,
                    "{\"practice_id\":\"" + practice + "\",\"request_id\":\"" + request + "\"}");
            assertThat(response.statusCode()).isEqualTo(500);
        }
        assertThat(get("/health", null).statusCode()).isEqualTo(200);
        String after = scrape();
        assertThat(metric(after, "acttub_http_requests_total", "status_class=\"5xx\"",
                "latency_class=\"long_running\"" )).isEqualTo(3);
        double total = after.lines().filter(line -> line.startsWith("acttub_http_requests_total{"))
                .mapToDouble(line -> Double.parseDouble(line.substring(line.lastIndexOf(' ') + 1))).sum();
        assertThat(total).isEqualTo(3);
        assertThat(3d / total).isGreaterThanOrEqualTo(0.05);
        assertThat(after).doesNotContain(user.toString(), practice.toString(), bearer);
    }

    @Test
    void scrapeCountsRealResponsesUsingTemplatesWithoutMonitoringTrafficOrSensitiveLabels() throws Exception {
        String before = scrape();
        UUID user = fixtures.insertUser();
        AccountFixtures.completeProfile(jdbc, user);
        String bearer = "Bearer " + context.getBean(JwtService.class).issueAccessToken(user).value();
        UUID missing = UUID.randomUUID();
        assertThat(get("/v2/practices", bearer).statusCode()).isEqualTo(200);
        assertThat(get("/v2/practices", bearer).statusCode()).isEqualTo(200);
        assertThat(get("/v2/practices/" + missing, bearer).statusCode()).isEqualTo(404);
        assertThat(get("/v2/practices", "Bearer invalid-private-token").statusCode()).isEqualTo(401);
        assertThat(get("/unmatched-sensitive-path?token=private-query", null).statusCode()).isEqualTo(404);
        assertThat(get("/another-sensitive-path", null).statusCode()).isEqualTo(404);
        assertThat(get("/health", null).statusCode()).isEqualTo(200);

        UUID practice = currentPractice(user);
        UUID request = UUID.randomUUID();
        var failure = post("/v2/coach/start", bearer, request,
                "{\"practice_id\":\"" + practice + "\",\"request_id\":\"" + request + "\"}");
        assertThat(failure.statusCode()).isEqualTo(500);
        assertThat(failure.body()).startsWith("{\"detail\":");

        String scrape = scrape();
        assertThat(metric(scrape, "http_server_requests_seconds_count", "uri=\"/v2/practices\"", "status=\"200\"", "method=\"GET\""))
                .isEqualTo(2);
        assertThat(metric(scrape, "http_server_requests_seconds_count", "uri=\"/v2/practices/{practice_id}\"",
                "status=\"404\"", "latency_class=\"ordinary\"", "environment=\"dev\""))
                .isEqualTo(1);
        assertThat(metric(scrape, "http_server_requests_seconds_count", "uri=\"/v2/coach/start\"",
                "status=\"500\"", "latency_class=\"long_running\"")
                - metric(before, "http_server_requests_seconds_count", "uri=\"/v2/coach/start\"",
                "status=\"500\"", "latency_class=\"long_running\""))
                .isEqualTo(1);
        assertThat(metric(scrape, "http_server_requests_seconds_count", "uri=\"/v2/practices\"", "status=\"401\""))
                .isEqualTo(1);
        assertThat(metric(scrape, "http_server_requests_seconds_count", "uri=\"NOT_FOUND\"", "status=\"404\""))
                .isEqualTo(2);
        assertThat(scrape).contains("http_server_requests_seconds_bucket{", "jvm_memory_used_bytes{",
                "hikaricp_connections_active{");
        assertThat(scrape).doesNotContain(missing.toString(), user.toString(), practice.toString(), TOKEN,
                "invalid-private-token", "unmatched-sensitive-path", "another-sensitive-path", "private-query",
                "uri=\"/health\"", "uri=\"/actuator", "http_url=", "jdbc:postgresql");
        for (var expected : java.util.Map.of("2xx", 2d, "4xx", 4d).entrySet()) {
            String status = "status_class=\"" + expected.getKey() + "\"";
            assertThat(metric(scrape, "acttub_http_requests_total", status, "latency_class=\"ordinary\"")
                    - metric(before, "acttub_http_requests_total", status, "latency_class=\"ordinary\""))
                    .isEqualTo(expected.getValue());
        }
        assertThat(metric(scrape, "acttub_http_requests_total", "status_class=\"5xx\"", "latency_class=\"long_running\"")
                - metric(before, "acttub_http_requests_total", "status_class=\"5xx\"", "latency_class=\"long_running\""))
                .isEqualTo(1);
        assertThat(scrape().lines().filter(line -> line.startsWith("http_server_requests_seconds_count{")).toList())
                .containsExactlyElementsOf(scrape.lines()
                        .filter(line -> line.startsWith("http_server_requests_seconds_count{")).toList());
    }

    @Test
    void requestsAreCountedByANormalizedClientVersionIncludingThoseSentToUpdate() throws Exception {
        String before = scrape();
        // 버전 헤더가 없으면 426(업데이트)이다. 막힌 요청도 경로 템플릿과 함께 센다.
        assertThat(getAs("/v2/consents/documents", null).statusCode()).isEqualTo(426);
        assertThat(getAs("/v2/consents/documents", "app/1.2.3").statusCode()).isEqualTo(200);
        assertThat(getAs("/v2/consents/documents", "app/1.2.3").statusCode()).isEqualTo(200);
        assertThat(getAs("/v2/consents/documents", "evil/\"forged\"").statusCode()).isEqualTo(200);

        String scrape = scrape();
        String uri = "uri=\"/v2/consents/documents\"";
        assertThat(metric(scrape, "http_server_requests_seconds_count", uri, "status=\"426\"", "method=\"GET\""))
                .as("426 도 UNKNOWN 이 아니라 부른 경로로 남는다").isEqualTo(1);
        assertThat(metric(scrape, "acttub_http_requests_by_client_total", "client=\"none\"", uri, "status=\"426\"",
                "method=\"GET\"", "environment=\"dev\"")).isEqualTo(1);
        assertThat(metric(scrape, "acttub_http_requests_by_client_total", "client=\"app/1.2.3\"", uri,
                "status=\"200\"")).isEqualTo(2);
        assertThat(metric(scrape, "acttub_http_requests_by_client_total", "client=\"other\"", uri,
                "status=\"200\"")).isEqualTo(1);
        assertThat(before).doesNotContain("client=\"app/1.2.3\"");
        assertThat(scrape).doesNotContain("forged", "evil");
    }

    @ParameterizedTest
    @ValueSource(strings = {"start", "reply"})
    void activeHttpLifetimeIncludesExternalCallsAndDatabaseWaits(String feature) throws Exception {
        UUID user = fixtures.insertUser();
        AccountFixtures.completeProfile(jdbc, user);
        String bearer = "Bearer " + context.getBean(JwtService.class).issueAccessToken(user).value();
        UUID practice = currentPractice(user);
        UUID requestId = UUID.randomUUID();
        String path = "/v2/coach/start";
        String body = "{\"practice_id\":\"" + practice + "\",\"request_id\":\"" + requestId + "\"}";
        String generated = "{\"message\":\"질문\",\"status\":\"continue\",\"handoff\":null}";
        if (feature.equals("reply")) {
            UUID conversation = UUID.randomUUID();
            jdbc.update("INSERT INTO coach_conversations(id,practice_id,start_request_id,status,state_revision) VALUES (?,?,?,'open',1)",
                    conversation, practice, UUID.randomUUID());
            jdbc.update("INSERT INTO coach_messages(id,conversation_id,turn_index,role,text) VALUES (?,?,0,'ai','앞선 질문')",
                    UUID.randomUUID(), conversation);
            path = "/v2/coach/reply";
            body = "{\"conversation_id\":\"" + conversation + "\",\"request_id\":\"" + requestId
                    + "\",\"revision\":1,\"text\":\"숨이 막혔어요\"}";
        }
        String route = "route=\"" + path + "\"";
        String featureLabel = "feature=\"coach\"";
        GateGenerator generator = context.getBean(GateGenerator.class);
        generator.block(generated);
        HttpRequest request = postRequest(path, bearer, requestId, body);
        CompletableFuture<HttpResponse<String>> original = CLIENT.sendAsync(request, HttpResponse.BodyHandlers.ofString());
        try {
            assertThat(generator.entered.await(5, TimeUnit.SECONDS)).isTrue();
            assertThat(original).isNotDone();
            assertThat(metric(scrape(), "acttub_http_active_seconds_count", route, featureLabel)).isEqualTo(1);

            // 조회에서 기다리는 동안도 HTTP 요청 수명에 포함된다. 바깥 모델 호출은 DB 잠금을 잡지 않는다.
            try (var connection = context.getBean(DataSource.class).getConnection()) {
                connection.setAutoCommit(false);
                try (var statement = connection.createStatement()) {
                    statement.execute("LOCK TABLE users IN ACCESS EXCLUSIVE MODE");
                }
                var repeated = CLIENT.sendAsync(request, HttpResponse.BodyHandlers.ofString());
                try {
                    await().atMost(Duration.ofSeconds(3)).untilAsserted(() ->
                            assertThat(metric(scrape(), "acttub_http_active_seconds_count", route, featureLabel))
                                    .isEqualTo(2));
                    assertThat(repeated).isNotDone();
                    context.getBean(MockClock.class).add(Duration.ofSeconds(61));
                    String active = scrape();
                    assertThat(metric(active, "acttub_http_active_seconds_max", route, featureLabel)).isEqualTo(61);
                    assertThat(metric(active, "acttub_http_active_seconds_sum", route, featureLabel)).isEqualTo(122);
                    assertThat(active).doesNotContain(user.toString(), practice.toString(), requestId.toString(), bearer);
                } finally {
                    connection.commit();
                }
                var conflict = repeated.get(5, TimeUnit.SECONDS);
                assertThat(conflict.statusCode()).isEqualTo(409);
                assertThat(conflict.body()).isEqualTo("{\"detail\":\"request is still processing\"}");
                assertThat(metric(scrape(), "acttub_http_active_seconds_count", route, featureLabel)).isEqualTo(1);
            }
        } finally {
            generator.release.countDown();
            original.get(10, TimeUnit.SECONDS);
            generator.reset();
        }
        assertThat(original.get().statusCode()).isEqualTo(200);
        await().atMost(Duration.ofSeconds(3)).untilAsserted(() -> {
            String finished = scrape();
            assertThat(metric(finished, "acttub_http_active_seconds_count", route, featureLabel)).isZero();
            assertThat(metric(finished, "acttub_http_active_seconds_max", route, featureLabel)).isZero();
            assertThat(metric(finished, "acttub_http_active_seconds_sum", route, featureLabel)).isZero();
        });
    }

    /** 옛(legacy) 회차. 가짜 생성기가 실패하면 코치 시작이 500 으로 끝난다(신형 회차는 직접 영상 코치라 저장소가 필요하다). */
    private UUID currentPractice(UUID owner) {
        UUID id = UUID.randomUUID();
        UUID video = UUID.randomUUID();
        UUID analysis = UUID.randomUUID();
        jdbc.update("INSERT INTO videos(id,user_id,object_key,content_type,byte_size,duration_ms) VALUES (?,?,?,'video/mp4',1000,8000)",
                video, owner, "monitoring/" + video);
        jdbc.update("""
                INSERT INTO practices(id,user_id,video_id,root_id,ordinal,stage,experience_version,blockage_kind,sub_branch)
                VALUES (?,?,?,?,1,'conversing',?,'분석','캐릭터 분석')
                """, id, owner, video, id, "legacy");
        jdbc.update("INSERT INTO analyses(id,practice_id,format,status,model,record,completed_at) VALUES (?,?,'legacy','ready','test',CAST(? AS jsonb),now())",
                analysis, id, "{\"observations\":[],\"uncertainties\":[]}");
        return id;
    }

    private HttpResponse<String> get(String path, String bearer) throws Exception {
        var request = HttpRequest.newBuilder(URI.create("http://localhost:" + port + path))
                .header(DefaultClientHeader.NAME, DefaultClientHeader.APP).GET();
        if (bearer != null) request.header("Authorization", bearer);
        return CLIENT.send(request.build(), HttpResponse.BodyHandlers.ofString());
    }

    /** 버전 헤더를 직접 정한다. {@code null} 이면 싣지 않는다. */
    private HttpResponse<String> getAs(String path, String client) throws Exception {
        var request = HttpRequest.newBuilder(URI.create("http://localhost:" + port + path)).GET();
        if (client != null) request.header(DefaultClientHeader.NAME, client);
        return CLIENT.send(request.build(), HttpResponse.BodyHandlers.ofString());
    }

    private HttpResponse<String> post(String path, String bearer, UUID requestId, String body) throws Exception {
        return CLIENT.send(postRequest(path, bearer, requestId, body), HttpResponse.BodyHandlers.ofString());
    }

    private HttpRequest postRequest(String path, String bearer, UUID requestId, String body) {
        return HttpRequest.newBuilder(URI.create("http://localhost:" + port + path))
                .timeout(Duration.ofSeconds(15)).header("Authorization", bearer)
                .header(DefaultClientHeader.NAME, DefaultClientHeader.APP)
                .header("Content-Type", "application/json").header("X-Request-Id", requestId.toString())
                .POST(HttpRequest.BodyPublishers.ofString(body)).build();
    }

    private String scrape() throws Exception {
        var response = CLIENT.send(HttpRequest.newBuilder(
                        URI.create("http://localhost:" + managementPort + "/actuator/prometheus"))
                .header("Authorization", "Bearer " + TOKEN).GET().build(), HttpResponse.BodyHandlers.ofString());
        assertThat(response.statusCode()).isEqualTo(200);
        return response.body();
    }

    private static double metric(String scrape, String name, String... labels) {
        var samples = scrape.lines().filter(line -> line.startsWith(name + "{"))
                .filter(line -> java.util.Arrays.stream(labels).allMatch(line::contains)).toList();
        assertThat(samples).as(name + " " + String.join(",", labels) + "; available: "
                + scrape.lines().filter(line -> line.startsWith(name + "{")).toList()).hasSize(1);
        return Double.parseDouble(samples.getFirst().substring(samples.getFirst().lastIndexOf(' ') + 1));
    }

    @TestConfiguration(proxyBeanMethods = false)
    static class GeneratorFixture {
        @Bean
        @Primary
        GateGenerator textGenerator() {
            return new GateGenerator();
        }

        @Bean
        MockClock metricClock() {
            return new MockClock();
        }
    }

    static class GateGenerator implements TextGenerator {
        /** {@code null} 이면 바깥 모델 호출이 실패한 것처럼 던진다. */
        private volatile String response;
        private volatile CountDownLatch entered = new CountDownLatch(0);
        private volatile CountDownLatch release = new CountDownLatch(0);

        void block(String response) {
            this.response = response;
            entered = new CountDownLatch(1);
            release = new CountDownLatch(1);
        }

        void reset() {
            response = null;
        }

        @Override
        public GeneratedText generate(String instructions, String input) {
            entered.countDown();
            try {
                if (!release.await(10, TimeUnit.SECONDS)) throw new IllegalStateException("test generator gate timed out");
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
                throw new IllegalStateException(interrupted);
            }
            if (response == null) throw new IllegalStateException("external model unavailable");
            return new GeneratedText(response, new TokenUsage(1, 1, 2));
        }
    }
}
