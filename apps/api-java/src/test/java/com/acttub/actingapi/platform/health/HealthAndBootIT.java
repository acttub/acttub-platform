package com.acttub.actingapi.platform.health;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.ArrayDeque;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

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
    @DisplayName("/health 슬라이스가 커밋된 openapi.json 과 같다 (required 순서만 제외)")
    void openApiHealthSliceMatchesCommittedSpec() throws Exception {
        JsonNode springdoc = MAPPER.readTree(get("/v3/api-docs"));
        // 계약의 소스는 커밋된 spec 이다 (/SPEC.md §9). 파일을 직접 읽어 대조한다.
        JsonNode committed = MAPPER.readTree(
                java.nio.file.Path.of("../api/spec/openapi.json").toFile());

        assertThat(normalize(springdoc.at("/components/schemas/HealthResponse")))
                .isEqualTo(normalize(committed.at("/components/schemas/HealthResponse")));
        assertThat(springdoc.at("/paths/~1health/get"))
                .isEqualTo(committed.at("/paths/~1health/get"));
    }

    @Test
    @DisplayName("도달 가능한 OpenAPI 컴포넌트의 title·nullable 표기가 Python 정본과 같다")
    void reachableOpenApiComponentTitlesAndNullabilityMatchCommittedSpec() throws Exception {
        JsonNode generated = MAPPER.readTree(get("/v3/api-docs"));
        JsonNode committed = MAPPER.readTree(
                java.nio.file.Path.of("../api/spec/openapi.json").toFile());

        Set<String> reachable = reachableComponents(generated);
        assertThat(reachable).isNotEmpty();
        for (String component : reachable) {
            JsonNode expected = committed.at("/components/schemas/" + component);
            assertThat(expected.isMissingNode())
                    .as("committed component %s exists", component)
                    .isFalse();
            JsonNode actual = generated.at("/components/schemas/" + component);
            assertSchemaTitlesAndNullability(
                    expected,
                    actual,
                    "#/components/schemas/" + component);
        }
    }

    @Test
    @DisplayName("practice-session 컴포넌트 형상이 커밋된 Python OpenAPI 와 같다")
    void practiceSessionComponentsMatchCommittedSpec() throws Exception {
        JsonNode generated = MAPPER.readTree(get("/v3/api-docs"));
        JsonNode committed = MAPPER.readTree(
                java.nio.file.Path.of("../api/spec/openapi.json").toFile());

        for (String component : java.util.List.of(
                "PracticeSessionRequest",
                "PracticeSessionAcceptedResponse",
                "PracticeSessionCreateResponse",
                "PracticeSessionListItem",
                "PracticeSessionListResponse",
                "PracticeSessionStatusResponse",
                "ObservationItem",
                "ObservationPackResponse",
                "PracticeSessionDetail")) {
            assertThat(normalizeSchemaTree(generated.at("/components/schemas/" + component)))
                    .as(component)
                    .isEqualTo(normalizeSchemaTree(
                            committed.at("/components/schemas/" + component)));
        }
    }

    @Test
    @DisplayName("community OpenAPI 슬라이스와 M2 잔여 컴포넌트가 Python 정본과 같다")
    void communityAndGlobalOpenApiLeftoversMatchCommittedSpec() throws Exception {
        JsonNode generated = MAPPER.readTree(get("/v3/api-docs"));
        JsonNode committed = MAPPER.readTree(
                java.nio.file.Path.of("../api/spec/openapi.json").toFile());

        for (String component : java.util.List.of(
                "CategoryPayload",
                "CategoryListResponse",
                "AuthorPayload",
                "PostPayload",
                "PostListResponse",
                "PostWriteRequest",
                "PostUpdateRequest",
                "CommentPayload",
                "CommentListResponse",
                "CommentWriteRequest",
                "LikeResponse",
                "ReportRequest",
                "BlockPayload",
                "BlockListResponse",
                "BlockRequest",
                "TokenPairResponse",
                "ValidationError")) {
            assertThat(normalizeSchemaTree(
                    generated.at("/components/schemas/" + component)))
                    .as(component)
                    .isEqualTo(normalizeSchemaTree(
                            committed.at("/components/schemas/" + component)));
        }

        committed.path("paths").properties().stream()
                .filter(entry -> entry.getKey().startsWith("/v2/community"))
                .forEach(entry -> assertThat(generated.path("paths").path(entry.getKey()))
                        .as(entry.getKey())
                        .isEqualTo(entry.getValue()));

        assertThat(generated.at(
                "/paths/~1v2~1auth~1login/post/responses/200/content"))
                .isEqualTo(committed.at(
                        "/paths/~1v2~1auth~1login/post/responses/200/content"));
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

    private static void assertSchemaTitlesAndNullability(
            JsonNode expected,
            JsonNode actual,
            String path) {
        assertThat(actual.path("title"))
                .as("%s title", path)
                .isEqualTo(expected.path("title"));
        assertThat(actual.has("nullable"))
                .as("%s uses OpenAPI 3.1 anyOf instead of nullable", path)
                .isFalse();

        boolean expectedNullable = hasNullAlternative(expected);
        boolean actualNullable = hasNullAlternative(actual);
        assertThat(actualNullable)
                .as("%s nullable", path)
                .isEqualTo(expectedNullable);
        if (expectedNullable) {
            assertThat(actual.path("anyOf"))
                    .as("%s nullable anyOf", path)
                    .isEqualTo(expected.path("anyOf"));
        }

        compareChildSchemas(expected, actual, path, "properties");
        compareChildSchema(expected, actual, path, "items");
        compareSchemaArray(expected, actual, path, "allOf");
        compareSchemaArray(expected, actual, path, "oneOf");
        compareSchemaArray(expected, actual, path, "anyOf");
    }

    private static void compareChildSchemas(
            JsonNode expected,
            JsonNode actual,
            String path,
            String field) {
        JsonNode expectedChildren = expected.path(field);
        if (!expectedChildren.isObject()) {
            return;
        }
        expectedChildren.properties().forEach(entry -> assertSchemaTitlesAndNullability(
                entry.getValue(),
                actual.path(field).path(entry.getKey()),
                path + "/" + field + "/" + entry.getKey()));
    }

    private static void compareChildSchema(
            JsonNode expected,
            JsonNode actual,
            String path,
            String field) {
        if (expected.path(field).isObject()) {
            assertSchemaTitlesAndNullability(
                    expected.path(field),
                    actual.path(field),
                    path + "/" + field);
        }
    }

    private static void compareSchemaArray(
            JsonNode expected,
            JsonNode actual,
            String path,
            String field) {
        JsonNode expectedChildren = expected.path(field);
        if (!expectedChildren.isArray()) {
            return;
        }
        for (int index = 0; index < expectedChildren.size(); index++) {
            assertSchemaTitlesAndNullability(
                    expectedChildren.get(index),
                    actual.path(field).path(index),
                    path + "/" + field + "/" + index);
        }
    }

    private static boolean hasNullAlternative(JsonNode schema) {
        JsonNode alternatives = schema.path("anyOf");
        if (!alternatives.isArray()) {
            return false;
        }
        for (JsonNode alternative : alternatives) {
            if ("null".equals(alternative.path("type").asText())) {
                return true;
            }
        }
        return false;
    }

    private static Set<String> reachableComponents(JsonNode document) {
        JsonNode schemas = document.at("/components/schemas");
        Set<String> result = new LinkedHashSet<>();
        ArrayDeque<JsonNode> pending = new ArrayDeque<>();
        pending.add(document.path("paths"));
        while (!pending.isEmpty()) {
            JsonNode current = pending.removeFirst();
            if (current.isObject()) {
                current.properties().forEach(entry -> {
                    if ("$ref".equals(entry.getKey()) && entry.getValue().isTextual()) {
                        String prefix = "#/components/schemas/";
                        String reference = entry.getValue().textValue();
                        if (reference.startsWith(prefix)) {
                            String component = reference.substring(prefix.length());
                            if (result.add(component) && schemas.has(component)) {
                                pending.addLast(schemas.get(component));
                            }
                        }
                    } else {
                        pending.addLast(entry.getValue());
                    }
                });
            } else if (current.isArray()) {
                current.forEach(pending::addLast);
            }
        }
        return result;
    }

    /** required 배열 순서는 의미가 없다. springdoc 은 알파벳순, pydantic 은 선언순으로 낸다. */
    private static JsonNode normalize(JsonNode schema) {
        com.fasterxml.jackson.databind.node.ObjectNode copy =
                (com.fasterxml.jackson.databind.node.ObjectNode) schema.deepCopy();
        if (copy.has("required")) {
            java.util.List<String> sorted = new java.util.ArrayList<>();
            copy.get("required").forEach(node -> sorted.add(node.asText()));
            java.util.Collections.sort(sorted);
            com.fasterxml.jackson.databind.node.ArrayNode array = MAPPER.createArrayNode();
            sorted.forEach(array::add);
            copy.set("required", array);
        }
        return copy;
    }

    private static JsonNode normalizeSchemaTree(JsonNode node) {
        JsonNode copy = node.deepCopy();
        normalizeRequiredArrays(copy);
        return copy;
    }

    private static void normalizeRequiredArrays(JsonNode node) {
        if (node.isObject()) {
            if (node.has("required") && node.get("required").isArray()) {
                java.util.List<String> sorted = new java.util.ArrayList<>();
                node.get("required").forEach(item -> sorted.add(item.asText()));
                java.util.Collections.sort(sorted);
                com.fasterxml.jackson.databind.node.ArrayNode replacement =
                        MAPPER.createArrayNode();
                sorted.forEach(replacement::add);
                ((com.fasterxml.jackson.databind.node.ObjectNode) node)
                        .set("required", replacement);
            }
            node.forEach(HealthAndBootIT::normalizeRequiredArrays);
        } else if (node.isArray()) {
            node.forEach(HealthAndBootIT::normalizeRequiredArrays);
        }
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
     * 근거가 "마운트되지 않음"에서 "라우터가 없음"으로 바뀌었지만 계약은 그대로다. 하네스에는
     * 이 경로를 밟는 스텝이 없으므로 여기서 직접 고정한다 — 없으면 누군가 catch-all 이나
     * 정적 리소스 매핑을 켰을 때 조용히 404 가 아니게 된다.
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
