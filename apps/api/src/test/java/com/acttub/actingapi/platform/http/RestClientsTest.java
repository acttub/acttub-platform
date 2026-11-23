package com.acttub.actingapi.platform.http;

import static com.tngtech.archunit.core.domain.JavaCall.Predicates.target;
import static com.tngtech.archunit.core.domain.JavaClass.Predicates.type;
import static com.tngtech.archunit.core.domain.properties.HasName.Predicates.nameMatching;
import static com.tngtech.archunit.core.domain.properties.HasOwner.Predicates.With.owner;
import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses;
import static org.assertj.core.api.Assertions.assertThat;

import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import com.sun.net.httpserver.HttpServer;
import com.tngtech.archunit.core.importer.ClassFileImporter;
import com.tngtech.archunit.core.importer.ImportOption;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.web.client.RestClient;

/**
 * 바깥 API 를 부르는 {@link RestClient} 가 JSON 을 Boot 3.5 때와 같게(Jackson 2) 읽고 쓰는지 실제 HTTP 로 본다.
 *
 * <p>아래 기대값은 Boot 3.5.16 의 {@code RestClient.builder()} 가 낸 그대로다. Jackson 3 변환기가 골라지면
 * Jackson 2 {@code JsonNode} 는 노드 속성 목록({@code "nodeType":"OBJECT"} …)으로 나가고, {@code @JsonNaming} 은
 * 무시되어 필드 이름이 camelCase 로 바뀐다.
 */
class RestClientsTest {

    private static final ObjectMapper JSON = new ObjectMapper();

    /** 결제·알림 본문처럼 Jackson 2 의 이름 규칙 주석을 쓰는 모양. */
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record Order(String orderId, String posterUrl) {
    }

    private HttpServer server;
    private final AtomicReference<String> received = new AtomicReference<>();
    private volatile String reply = "{}";

    @BeforeEach
    void start() throws Exception {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> {
            received.set(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            byte[] body = reply.getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, body.length);
            exchange.getResponseBody().write(body);
            exchange.close();
        });
        server.start();
    }

    @AfterEach
    void stop() {
        server.stop(0);
    }

    private RestClient client() {
        return RestClients.builder().baseUrl("http://127.0.0.1:" + server.getAddress().getPort()).build();
    }

    private String send(Object body) {
        client().post().uri("/").contentType(MediaType.APPLICATION_JSON).body(body).retrieve().toBodilessEntity();
        return received.get();
    }

    @Test
    void jackson2TreeGoesOutAsTheJsonItHolds() throws Exception {
        // OpenAI 요청(RestClientOpenAiTransport)이 이 모양이다.
        assertThat(send(JSON.readTree("{\"model\":\"m\",\"input\":\"안녕\"}"))).isEqualTo("{\"model\":\"m\",\"input\":\"안녕\"}");
    }

    @Test
    void jackson2NamingAnnotationNamesTheOutgoingFields() {
        assertThat(send(new Order("o-1", null))).isEqualTo("{\"order_id\":\"o-1\",\"poster_url\":null}");
    }

    @Test
    void plainMapGoesOutAsIs() {
        // Slack 알림(SupportSlackChannel)이 이 모양이다.
        assertThat(send(Map.of("text", "문의 <1>"))).isEqualTo("{\"text\":\"문의 <1>\"}");
    }

    @Test
    void responsesAreReadWithJackson2() {
        reply = "{\"order_id\":\"o-2\",\"poster_url\":\"https://x/p.jpg\"}";

        assertThat(client().get().uri("/").retrieve().body(Order.class)).isEqualTo(new Order("o-2", "https://x/p.jpg"));
        assertThat(client().get().uri("/").retrieve().body(JsonNode.class).path("order_id").asText()).isEqualTo("o-2");
    }

    @Test
    void mainCodeBuildsRestClientsOnlyHere() {
        noClasses().that().doNotHaveFullyQualifiedName(RestClients.class.getName())
                .should().callMethodWhere(target(owner(type(RestClient.class))).and(target(nameMatching("builder|create"))))
                .because("RestClient.builder()·create() 는 Jackson 3 이 classpath 에 있으면 그것으로 JSON 을 쓴다")
                .check(new ClassFileImporter().withImportOption(ImportOption.Predefined.DO_NOT_INCLUDE_TESTS)
                        .importPackages("com.acttub.actingapi"));
    }
}
