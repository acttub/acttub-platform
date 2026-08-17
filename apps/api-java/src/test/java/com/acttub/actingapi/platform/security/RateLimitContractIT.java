package com.acttub.actingapi.platform.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import java.util.UUID;
import java.util.function.Supplier;

import com.acttub.actingapi.feature.auth.app.JwtService;
import com.acttub.actingapi.support.PostgresContainerSupport;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

/**
 * 분당 60 을 넘긴 요청이 429 {@code rate limit exceeded} 로 거절되는지, <b>세 자리 전부</b>에서
 * 본다 — 주체로 세는 게이트({@code AccessGate}) · 인증 라우터의 주체별 · 같은 라우터의 IP별.
 *
 * <p><b>계약 하네스에서 옮겨 온 기대값이다</b>(SOMA-403 2단계). 하네스는 이것을 세 케이스로
 * 갖고 있었고, {@code FixedWindowRateLimiter} 단위 테스트는 카운터만 볼 뿐 <b>어떤 응답이
 * 나가는지를 보지 않는다.</b>
 *
 * <p>⚠ <b>주체별 두 자리는 같은 키(사용자 id)를 공유한다.</b> 한 사용자로 둘을 잇달아 때리면
 * 앞의 것이 소진시킨 카운터에 뒤의 것이 걸려, 검사가 자기 경로를 밟았는지 알 수 없다. 그래서
 * 케이스마다 사용자를 새로 만든다.
 *
 * <p>⚠ <b>IP 키는 새로 만들 수 없다.</b> {@code auth-ip:127.0.0.1} 하나를 로그인·갱신이 함께
 * 쓰고, 카운터는 process-local 이라 {@code TRUNCATE} 로도 지워지지 않으며
 * {@code FixedWindowRateLimiter.reset()} 은 {@code contract} 프로파일에서만 동작한다. 지금은
 * 이 클래스에서 그 키를 쓰는 것이 갱신 하나뿐이라 성립한다 — <b>여기에 로그인이나 갱신 케이스를
 * 더하면 이미 깎인 창에 걸려 {@code isGreaterThan(60)} 이 깨진다.</b> 그때는 케이스를 클래스로
 * 갈라 컨텍스트를 나눠야 한다.
 */
@SpringBootTest(properties = "JWT_SECRET=test-secret")
@AutoConfigureMockMvc
class RateLimitContractIT {

    /**
     * 한도(60)의 두 배보다 크다. 고정 윈도우는 분 경계에서 카운터를 되돌리므로, 경계를 한 번
     * 넘더라도 <b>반드시</b> 한도를 넘기려면 120 을 넘겨야 한다. 61 회만 보내면 경계에 걸친
     * 실행에서만 초록이 아닌 flaky 가 된다.
     */
    private static final int ENOUGH_TO_CROSS_ANY_WINDOW = 121;

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        String name = PostgresContainerSupport.createDatabaseName("rate_limit");
        registry.add("spring.datasource.url", () -> PostgresContainerSupport.jdbcUrlFor(name));
        registry.add("spring.datasource.username", PostgresContainerSupport.POSTGRES::getUsername);
        registry.add("spring.datasource.password", PostgresContainerSupport.POSTGRES::getPassword);
    }

    @Autowired
    MockMvc mvc;

    @Autowired
    JdbcTemplate jdbc;

    @Autowired
    JwtService jwt;

    @Autowired
    ObjectMapper mapper;

    @BeforeEach
    void setUp() {
        jdbc.execute("TRUNCATE TABLE users, consent_documents RESTART IDENTITY CASCADE");
    }

    @Test
    void theRateLimitedGateRejectsTheSixtyFirstRequestOfAUser() throws Exception {
        UUID userId = insertUser();
        assertRejectedAfterTheLimit(() -> get("/v2/me")
                .header("Authorization", bearer(userId)));
    }

    /**
     * 로그아웃은 <b>인증한 뒤</b> 주체별로 센다. 토큰이 유효하기만 하면 본문이 무엇이든 세는
     * 자리까지 도달한다 — 그래서 401 이 60 번 나오다 61 번째가 429 다.
     */
    @Test
    void theAuthRouterCountsPerUserAfterAuthenticating() throws Exception {
        UUID userId = insertUser();
        assertRejectedAfterTheLimit(() -> post("/v2/auth/logout")
                .header("Authorization", bearer(userId))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"refresh_token\":\"없는 토큰\"}"));
    }

    /** 갱신은 인증 이전에 IP 로 센다 — 토큰이 틀려도 카운터는 오른다. */
    @Test
    void theAuthRouterCountsPerIpBeforeItLooksAtTheToken() throws Exception {
        assertRejectedAfterTheLimit(() -> post("/v2/auth/refresh")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"refresh_token\":\"없는 토큰\"}"));
    }

    private void assertRejectedAfterTheLimit(Supplier<MockHttpServletRequestBuilder> request)
            throws Exception {
        for (int attempt = 1; attempt <= ENOUGH_TO_CROSS_ANY_WINDOW; attempt++) {
            var response = mvc.perform(request.get()).andReturn().getResponse();
            if (response.getStatus() == 429) {
                assertThat(mapper.readTree(response.getContentAsString()))
                        .isEqualTo(mapper.readTree("{\"detail\":\"rate limit exceeded\"}"));
                assertThat(attempt)
                        .as("한도 60 을 넘기기 전에 거절됐다")
                        .isGreaterThan(60);
                return;
            }
        }
        throw new AssertionError(
                ENOUGH_TO_CROSS_ANY_WINDOW + " 회를 보내도 429 가 나오지 않았다");
    }

    private UUID insertUser() {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO users(id, status) VALUES (?, 'active'::user_status_t)", id);
        return id;
    }

    private String bearer(UUID userId) {
        return "Bearer " + jwt.issueAccessToken(userId).value();
    }
}
