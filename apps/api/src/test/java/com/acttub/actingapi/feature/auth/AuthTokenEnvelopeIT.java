package com.acttub.actingapi.feature.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import java.time.Instant;
import java.time.ZoneOffset;
import java.util.UUID;

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
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;

/**
 * 로그인·갱신이 <b>성공했을 때</b> 내는 토큰 봉투를 못박는다.
 *
 * <p>🔎 <b>비어 있던 자리를 메운다.</b> {@code token_type} 의 값 {@code "bearer"} 를 단언하던
 * 곳은 {@code FastApiInteropIT} 하나뿐이었고, 그마저 <b>FastAPI 의 응답</b>을 본 것이라
 * 자바가 무엇을 내는지는 아무도 보지 않았다. 그 테스트는 파이썬과 함께 사라진다
 * ({@code SOMA-403} 5단계). OpenAPI 스냅샷도 여기를 못 덮는다 — {@code token_type} 을
 * {@code type: string} 까지만 적을 뿐 값을 고정하지 않는다.
 *
 * <p>다른 자리가 이미 보는 것은 여기서 다시 세지 않는다 — 실패 계약은
 * {@code AuthErrorContractIT}, 갱신 회전과 재사용 무효화는 {@code RefreshRotationIT} 다.
 */
@SpringBootTest(properties = {"JWT_SECRET=test-secret", "DEVELOPMENT_AUTH_PROVIDER=1"})
@AutoConfigureMockMvc
class AuthTokenEnvelopeIT {

    /** 액세스 토큰 수명. {@code JwtServiceTest} 가 발급 쪽에서 같은 값을 못박는다. */
    private static final long ACCESS_TOKEN_TTL_SECONDS = 1800;
    private static final UUID PRIVACY_DOCUMENT =
            UUID.fromString("00000000-0000-4000-8000-000000000201");
    private static final UUID TERMS_DOCUMENT =
            UUID.fromString("00000000-0000-4000-8000-000000000202");

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        String name = PostgresContainerSupport.createDatabaseName("auth_token_envelope");
        registry.add("spring.datasource.url", () -> PostgresContainerSupport.jdbcUrlFor(name));
        registry.add("spring.datasource.username", PostgresContainerSupport.POSTGRES::getUsername);
        registry.add("spring.datasource.password", PostgresContainerSupport.POSTGRES::getPassword);
    }

    @Autowired
    MockMvc mvc;

    @Autowired
    ObjectMapper mapper;

    @Autowired
    JdbcTemplate jdbc;

    @BeforeEach
    void setUp() {
        jdbc.execute("TRUNCATE TABLE users,consent_documents RESTART IDENTITY CASCADE");
        insertDocument(PRIVACY_DOCUMENT, "privacy", Instant.parse("2026-01-01T00:00:00Z"));
        insertDocument(TERMS_DOCUMENT, "terms", Instant.parse("2026-01-02T00:00:00Z"));
    }

    @Test
    @DisplayName("로그인 성공 응답이 bearer 봉투와 사용자·보류 동의를 함께 낸다")
    void loginReturnsTheBearerEnvelope() throws Exception {
        JsonNode body = login();

        assertTokenEnvelope(body);
        assertThat(body.fieldNames()).toIterable().containsExactlyInAnyOrder(
                "access_token", "refresh_token", "token_type", "expires_in",
                "user", "pending_consents");
        assertThat(body.path("user").path("id").textValue()).isNotBlank();
        assertThat(body.path("pending_consents").isArray()).isTrue();
        assertThat(body.path("pending_consents")).hasSize(2);
    }

    @Test
    @DisplayName("로그인 보류 동의는 종류 순이 아니라 발행 시각 순으로 낸다")
    void loginOrdersPendingConsentsByPublishedAt() throws Exception {
        JsonNode pending = login().path("pending_consents");

        assertThat(pending).hasSize(2);
        assertThat(pending.get(0).path("id").textValue())
                .isEqualTo(PRIVACY_DOCUMENT.toString());
        assertThat(pending.get(1).path("id").textValue())
                .isEqualTo(TERMS_DOCUMENT.toString());
    }

    @Test
    @DisplayName("갱신 성공 응답이 같은 bearer 봉투를 내되 사용자는 싣지 않는다")
    void refreshReturnsTheSameBearerEnvelopeWithoutTheUser() throws Exception {
        String refreshToken = login().path("refresh_token").textValue();

        JsonNode body = mapper.readTree(mvc.perform(post("/v2/auth/refresh")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"refresh_token\":\"" + refreshToken + "\"}"))
                .andReturn()
                .getResponse()
                .getContentAsString());

        assertTokenEnvelope(body);
        assertThat(body.fieldNames()).toIterable().containsExactlyInAnyOrder(
                "access_token", "refresh_token", "token_type", "expires_in");
    }

    private void assertTokenEnvelope(JsonNode body) {
        assertThat(body.path("token_type").textValue())
                .as("토큰 타입은 소문자 bearer 다")
                .isEqualTo("bearer");
        assertThat(body.path("expires_in").longValue()).isEqualTo(ACCESS_TOKEN_TTL_SECONDS);
        assertThat(body.path("access_token").textValue()).isNotBlank();
        assertThat(body.path("refresh_token").textValue()).isNotBlank();
    }

    private JsonNode login() throws Exception {
        var response = mvc.perform(post("/v2/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"provider\":\"development\",\"id_token\":\"dev-envelope\"}"))
                .andReturn()
                .getResponse();
        assertThat(response.getStatus())
                .as("개발 로그인이 실패했다: %s", response.getContentAsString())
                .isEqualTo(200);
        return mapper.readTree(response.getContentAsString());
    }

    private void insertDocument(UUID id, String type, Instant publishedAt) {
        jdbc.update("""
                INSERT INTO consent_documents(
                    id,type,version,title,body,required,published_at)
                VALUES (?,?,'v1',?,?,true,?)
                """, id, type, type, type + " body", publishedAt.atOffset(ZoneOffset.UTC));
    }
}
