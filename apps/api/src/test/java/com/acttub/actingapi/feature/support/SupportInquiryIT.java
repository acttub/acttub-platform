package com.acttub.actingapi.feature.support;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import java.util.Map;
import java.util.UUID;

import com.acttub.actingapi.feature.auth.app.JwtService;
import com.acttub.actingapi.support.AccountFixtures;
import com.acttub.actingapi.support.PostgresContainerSupport;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

/**
 * app.support-inquiry 를 HTTP 와 실제 Postgres 로 본다 — 비로그인 접수, 토큰이 있을 때의 user_id, 잘못된 토큰,
 * 검증, IP 한도, 운영 조회.
 */
@SpringBootTest(properties = {
    "JWT_SECRET=test-secret",
    "ADMIN_OPS_TOKEN=admin-secret",
    "ACCOUNT_CLEANUP_ENABLED=false",
    "ACCOUNT_HOUSEKEEPING_ENABLED=false",
    "ANALYSIS_WORKER_ENABLED=false"
})
@AutoConfigureMockMvc
class SupportInquiryIT {

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        String name = PostgresContainerSupport.createDatabaseName("support_inquiry");
        registry.add("spring.datasource.url", () -> PostgresContainerSupport.jdbcUrlFor(name));
        registry.add("spring.datasource.username", PostgresContainerSupport.POSTGRES::getUsername);
        registry.add("spring.datasource.password", PostgresContainerSupport.POSTGRES::getPassword);
    }

    @Autowired
    MockMvc mvc;
    @Autowired
    JdbcTemplate jdbc;
    @Autowired
    ObjectMapper mapper;
    @Autowired
    JwtService jwt;

    // 한도 카운터는 컨텍스트 안에서 지워지지 않으므로 테스트마다 다른 주소를 쓴다(인스턴스가 아니라 클래스 단위로 센다).
    private static final java.util.concurrent.atomic.AtomicInteger IP_COUNTER = new java.util.concurrent.atomic.AtomicInteger(10);

    @BeforeEach
    void setUp() {
        jdbc.execute("TRUNCATE TABLE support_inquiries");
    }

    @Test
    @DisplayName("로그인 없이 접수 — 201 {id, created_at}, user_id 는 NULL, client 와 status open 이 남는다")
    void anonymousSubmission() throws Exception {
        MockHttpServletResponse response = send(inquiry("refund", " user@example.com ", "  환불하고 싶어요, 방법이 궁금해요  "), null, ip(), 201);
        JsonNode json = mapper.readTree(response.getContentAsString());

        assertThat(json.fieldNames()).toIterable().containsExactlyInAnyOrder("id", "created_at");
        Map<String, Object> row = jdbc.queryForMap("SELECT * FROM support_inquiries WHERE id=?",
                UUID.fromString(json.path("id").textValue()));
        assertThat(row.get("category")).isEqualTo("refund");
        assertThat(row.get("email")).isEqualTo("user@example.com");
        assertThat(row.get("body")).isEqualTo("환불하고 싶어요, 방법이 궁금해요");
        assertThat(row.get("user_id")).isNull();
        assertThat(row.get("client")).isEqualTo(com.acttub.actingapi.support.DefaultClientHeader.APP);
        assertThat(row.get("status")).isEqualTo("open");
    }

    @Test
    @DisplayName("유효한 액세스 토큰이 붙어 있으면 user_id 를 남기고, 만료·잘못된 토큰이면 비로그인으로 받는다")
    void tokenIsOptional() throws Exception {
        UUID user = UUID.randomUUID();
        jdbc.update("INSERT INTO users(id,status) VALUES (?,'active')", user);
        jdbc.update("INSERT INTO user_identities(id,user_id,provider,provider_uid) VALUES (?,?,'google',?)",
                UUID.randomUUID(), user, "g-" + user);
        AccountFixtures.passGate(jdbc, user);

        send(inquiry("account", "a@b.co", "로그인한 상태에서 보내는 문의입니다"),
                "Bearer " + jwt.issueAccessToken(user).value(), ip(), 201);
        send(inquiry("account", "a@b.co", "깨진 토큰으로 보내는 문의입니다"), "Bearer not-a-token", ip(), 201);

        assertThat(jdbc.queryForList("SELECT user_id FROM support_inquiries ORDER BY created_at, body"))
                .extracting(r -> r.get("user_id"))
                .containsExactlyInAnyOrder(user, null);
    }

    @Test
    @DisplayName("검증 — 분류 밖·이메일 형식·본문 길이는 422 배열, 저장하지 않는다")
    void validation() throws Exception {
        String ok = "충분히 긴 문의 본문입니다";
        for (String payload : new String[] {
            inquiry("nope", "a@b.co", ok),
            inquiry("bug", "not-an-email", ok),
            inquiry("bug", "a@b.co", "짧음"),
            inquiry("bug", "a@b.co", "가".repeat(3001)),
            "{\"category\":\"bug\",\"email\":\"a@b.co\"}",
            "{\"category\":\"bug\",\"email\":\"a@b.co\",\"body\":\"" + ok + "\",\"extra\":1}"}) {
            JsonNode json = mapper.readTree(send(payload, null, ip(), 422).getContentAsString());
            assertThat(json.path("detail").isArray()).as(payload).isTrue();
        }
        assertThat(jdbc.queryForObject("SELECT count(*) FROM support_inquiries", Integer.class)).isZero();
    }

    @Test
    @DisplayName("같은 IP 는 10분에 5건까지 — 6번째는 429, 다른 IP 는 영향이 없다")
    void ipRateLimit() throws Exception {
        String address = ip();
        for (int i = 0; i < 5; i++) {
            send(inquiry("other", "a@b.co", "한도 안의 문의 본문 " + i), null, address, 201);
        }
        MockHttpServletResponse limited = send(inquiry("other", "a@b.co", "한도를 넘는 문의 본문"), null, address, 429);
        assertThat(mapper.readTree(limited.getContentAsString()).path("detail").textValue())
                .isEqualTo("rate limit exceeded");
        send(inquiry("other", "a@b.co", "다른 주소의 문의 본문"), null, ip(), 201);
    }

    @Test
    @DisplayName("운영 조회 — 토큰 없으면 401, 새것부터, status·limit 필터, 잘못된 값은 422")
    void adminList() throws Exception {
        send(inquiry("bug", "one@example.com", "첫 번째 문의 본문입니다"), null, ip(), 201);
        send(inquiry("billing", "two@example.com", "두 번째 문의 본문입니다"), null, ip(), 201);
        jdbc.update("UPDATE support_inquiries SET status='closed' WHERE email='one@example.com'");

        assertThat(mvc.perform(get("/v2/admin/support/inquiries")).andReturn().getResponse().getStatus())
                .isEqualTo(401);
        JsonNode all = admin("/v2/admin/support/inquiries", 200);
        assertThat(all.path("inquiries")).hasSize(2);
        assertThat(all.at("/inquiries/0/email").textValue()).isEqualTo("two@example.com");
        assertThat(all.at("/inquiries/0").fieldNames()).toIterable().containsExactlyInAnyOrder(
                "id", "category", "email", "body", "user_id", "client", "status", "created_at");
        assertThat(admin("/v2/admin/support/inquiries?status=closed", 200).path("inquiries")).hasSize(1);
        assertThat(admin("/v2/admin/support/inquiries?limit=1", 200).path("inquiries")).hasSize(1);
        admin("/v2/admin/support/inquiries?limit=0", 422);
        admin("/v2/admin/support/inquiries?limit=201", 422);
        admin("/v2/admin/support/inquiries?status=weird", 422);
    }

    private JsonNode admin(String path, int status) throws Exception {
        MockHttpServletResponse response = mvc.perform(get(path).header("Authorization", "Bearer admin-secret"))
                .andReturn().getResponse();
        assertThat(response.getStatus()).as(response.getContentAsString()).isEqualTo(status);
        return mapper.readTree(response.getContentAsString());
    }

    private String ip() {
        return "203.0.113." + IP_COUNTER.getAndIncrement();
    }

    private static String inquiry(String category, String email, String body) {
        return "{\"category\":\"%s\",\"email\":\"%s\",\"body\":\"%s\"}".formatted(category, email, body);
    }

    private MockHttpServletResponse send(String payload, String bearer, String address, int status) throws Exception {
        MockHttpServletRequestBuilder request = post("/v2/support/inquiries")
                .header("X-Forwarded-For", address)
                .contentType(MediaType.APPLICATION_JSON)
                .content(payload);
        if (bearer != null) {
            request.header("Authorization", bearer);
        }
        MockHttpServletResponse response = mvc.perform(request).andReturn().getResponse();
        assertThat(response.getStatus()).as(response.getContentAsString()).isEqualTo(status);
        return response;
    }
}
