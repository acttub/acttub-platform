package com.acttub.actingapi.platform.health;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.List;

import com.acttub.actingapi.ActingApiApplication;
import com.acttub.actingapi.support.PostgresContainerSupport;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.boot.web.servlet.context.ServletWebServerApplicationContext;
import org.springframework.context.ConfigurableApplicationContext;

/**
 * 애플리케이션을 <b>실제 배포 형식의 {@code DATABASE_URL} 로</b> 통째로 띄운다.
 *
 * <p>한 번의 기동으로 M0 완료 기준 여러 개를 동시에 확인한다.
 * <ul>
 *   <li>{@code postgresql://user:pass@host:port/db} 로 부팅 (/SPEC.md §5-6)</li>
 *   <li>기동 중 Flyway 가 빈 DB 를 V1 로 재구축 → Hibernate {@code ddl-auto: validate} 통과</li>
 *   <li>{@code GET /health} 가 기존 계약과 같은 형상</li>
 *   <li>springdoc {@code /v3/api-docs} 의 {@code HealthResponse}</li>
 * </ul>
 *
 * <p>{@code @SpringBootTest} 대신 {@link SpringApplicationBuilder} 를 쓴 이유:
 * {@code @DynamicPropertySource} 가 심는 프로퍼티 소스는
 * {@code EnvironmentPostProcessor} 가 이미 돈 <b>뒤에</b> 붙어서
 * {@code DatabaseUrlEnvironmentPostProcessor} 가 {@code DATABASE_URL} 을 볼 수 없다.
 * {@code SpringApplication.setDefaultProperties} 는 환경 준비 <b>전에</b> 들어가므로 보인다.
 */
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class HealthAndBootIT {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private static ConfigurableApplicationContext context;
    private static int port;

    @BeforeAll
    static void bootWithDeploymentStyleDatabaseUrl() {
        String databaseUrl = PostgresContainerSupport.deployStyleUrl(
                PostgresContainerSupport.createDatabaseName("boot_it"));

        context = new SpringApplicationBuilder(ActingApiApplication.class)
                .properties(
                        "DATABASE_URL=" + databaseUrl,
                        "JWT_SECRET=test-secret",
                        "server.port=0",
                        "GEMINI_API_KEY=test-not-a-real-key",
                        "GEMINI_MODEL=gemini-2.5-flash")
                .run();
        port = ((ServletWebServerApplicationContext) context).getWebServer().getPort();
    }

    @AfterAll
    static void shutdown() {
        if (context != null) {
            context.close();
        }
    }

    @Test
    @DisplayName("GET /health 가 기존 계약과 같은 형상을 낸다 (app.py:236-248)")
    void healthMatchesLegacyShape() throws Exception {
        JsonNode body = MAPPER.readTree(get("/health"));

        assertThat(body.fieldNames()).toIterable()
                .containsExactly("status", "services", "model", "keep_alive", "commit");
        assertThat(body.get("status").asText()).isEqualTo("ok");
        assertThat(body.get("services")).hasSize(3);
        assertThat(body.get("services").get(0).asText()).isEqualTo("summary");
        assertThat(body.get("services").get(1).asText()).isEqualTo("coach");
        assertThat(body.get("services").get(2).asText()).isEqualTo("report");
        assertThat(body.get("model").asText()).isEqualTo("gemini-2.5-flash");
        assertThat(body.get("keep_alive").isBoolean()).isTrue();
        assertThat(body.get("keep_alive").asBoolean()).isFalse();
        assertThat(body.get("commit").asText()).isEqualTo("unknown");
    }

    @Test
    @DisplayName("springdoc 이 HealthResponse 를 additionalProperties:false + status const 로 낸다")
    void openApiHealthResponseMatchesPydanticShape() throws Exception {
        JsonNode doc = MAPPER.readTree(get("/v3/api-docs"));

        assertThat(doc.get("openapi").asText()).startsWith("3.1");
        assertThat(doc.at("/info/title").textValue()).isEqualTo("acting-api");
        assertThat(doc.at("/info/version").textValue()).isEqualTo("0.1.0");
        assertThat(doc.at("/info/description").textValue()).isEqualTo(
                "연기 분석 플랫폼 API v2. Bearer access token을 사용합니다.");
        assertThat(doc.has("servers")).isFalse();

        JsonNode schema = doc.at("/components/schemas/HealthResponse");
        assertThat(schema.isMissingNode()).isFalse();
        assertThat(schema.get("type").asText()).isEqualTo("object");
        assertThat(schema.get("additionalProperties").asBoolean()).isFalse();
        assertThat(schema.at("/properties/status/const").asText()).isEqualTo("ok");
        assertThat(schema.at("/properties/keep_alive/type").asText()).isEqualTo("boolean");
        assertThat(schema.at("/properties/services/type").asText()).isEqualTo("array");

        java.util.List<String> required = new java.util.ArrayList<>();
        schema.get("required").forEach(node -> required.add(node.asText()));
        assertThat(required).containsExactlyInAnyOrder(
                "status", "services", "model", "keep_alive", "commit");

        assertThat(doc.at("/paths/~1health/get").isMissingNode()).isFalse();
    }

    @Test
    @DisplayName("default inventory에는 조건부 admin operation이 없다")
    void defaultInventoryExcludesAdminOperations() throws Exception {
        JsonNode generated = MAPPER.readTree(get("/v3/api-docs"));

        // admin 둘은 ADMIN_OPS_TOKEN 이 있을 때만 등록된다 (/SPEC.md §6-2).
        assertThat(generated.at("/paths/~1v2~1admin~1stats").isMissingNode()).isTrue();
        assertThat(generated.at("/paths/~1v2~1admin~1sessions").isMissingNode()).isTrue();

        // M4 라우트 넷은 §C 에서 열렸다 — 이제 있어야 한다.
        assertThat(generated.at("/paths/~1v2~1reports/post").isMissingNode()).isFalse();
        assertThat(generated.at("/paths/~1v2~1coach~1start").isMissingNode()).isFalse();
        assertThat(generated.at("/paths/~1v2~1coach~1reply").isMissingNode()).isFalse();
        assertThat(generated.at("/paths/~1v2~1coach~1confirm").isMissingNode()).isFalse();
    }

    @Test
    @DisplayName("virtual threads 가 켜져 있다 (/SPEC.md §2)")
    void virtualThreadsAreEnabled() {
        // Boot 는 spring.threads.virtual.enabled=true 일 때만 이 빈을 등록한다
        // (@ConditionalOnThreading(VIRTUAL)). 설정이 조용히 빠지는 것을 이걸로 잡는다.
        assertThat(context.containsBean("tomcatVirtualThreadsProtocolHandlerCustomizer")).isTrue();
    }

    /**
     * v1 경로 다섯은 404 다 (/SPEC.md §6 #14).
     *
     * <p>`SOMA-318` 이 acting-agent·acting-summary·acting-report 의 자체 라우터를 지우면서
     * 근거가 "마운트되지 않음"에서 "라우터가 없음"으로 바뀌었지만 계약은 그대로다. 이 경로를
     * 밟는 검사가 여기뿐이라 직접 고정한다 — 없으면 누군가 catch-all 이나 정적 리소스 매핑을
     * 켰을 때 조용히 404 가 아니게 된다.
     */
    @Test
    @DisplayName("v1 경로 다섯은 404 이고 오류 바디도 detail 형식이다")
    void legacyV1PathsAreNotFound() throws Exception {
        for (String path : List.of(
                "/summarize", "/coach/start", "/coach/reply", "/report",
                "/report/history/00000000-0000-4000-8000-000000000001")) {
            HttpResponse<String> response = HttpClient.newHttpClient().send(
                    HttpRequest.newBuilder(URI.create("http://localhost:" + port + path))
                            .GET().build(),
                    HttpResponse.BodyHandlers.ofString());
            assertThat(response.statusCode()).as(path).isEqualTo(404);
            assertThat(MAPPER.readTree(response.body()).has("detail")).as(path).isTrue();
        }
    }

    private String get(String path) throws Exception {
        HttpResponse<String> response = HttpClient.newHttpClient().send(
                HttpRequest.newBuilder(URI.create("http://localhost:" + port + path)).GET().build(),
                HttpResponse.BodyHandlers.ofString());
        assertThat(response.statusCode()).isEqualTo(200);
        return response.body();
    }
}
