package com.acttub.actingapi.feature.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import com.acttub.actingapi.support.PostgresContainerSupport;
import com.acttub.actingapi.support.StubProviders;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;

/**
 * account.login: "운영에서 꺼 둔 제공자로 로그인 — 400. 제공자 목록 조회 — 켜 둔 제공자만 나온다."
 *
 * <p>카카오·네이버를 검수 승인 전처럼 꺼 둔 서버다({@code AUTH_ENABLED_PROVIDERS} 의 기본값). 그
 * 제공자의 설정(키)도 없다 — 꺼 둔 것(400, 의도한 상태)과 설정이 빠진 것(503, 운영 사고)을 가른다.
 */
@SpringBootTest(properties = {
    "JWT_SECRET=test-secret",
    "ACCOUNT_CLEANUP_ENABLED=false",
    "AUTH_ENABLED_PROVIDERS=google,apple"
})
@AutoConfigureMockMvc
@Import(StubProviders.class)
class AccountDisabledProvidersIT {

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        String name = PostgresContainerSupport.createDatabaseName("account_disabled_providers");
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
    StubProviders.StubNaverTokens naver;

    @BeforeEach
    void setUp() {
        jdbc.execute("TRUNCATE TABLE users RESTART IDENTITY CASCADE");
        naver.reset();
    }

    @Test
    @DisplayName("account.login: 제공자 목록 조회 — 켜 둔 제공자만 나온다")
    void accountLogin_providerListShowsOnlyEnabledProviders() throws Exception {
        var response = mvc.perform(get("/v2/auth/providers")).andReturn().getResponse();

        assertThat(response.getStatus()).isEqualTo(200);
        assertThat(mapper.readTree(response.getContentAsString()))
                .isEqualTo(mapper.readTree("{\"providers\":[\"google\",\"apple\"]}"));
    }

    @Test
    @DisplayName("account.login: 운영에서 꺼 둔 제공자로 로그인 — 400 이고, 그 제공자를 부르지도 않는다")
    void accountLogin_loginWithADisabledProviderIsUnsupported() throws Exception {
        var kakao = login("{\"provider\":\"kakao\",\"id_token\":\"k-1|a@example.test\"}");
        var naverLogin = login("""
                {"provider":"naver","authorization_code":"n-1|a@naver.com","code_verifier":"v"}
                """);
        var unknown = login("{\"provider\":\"facebook\",\"id_token\":\"f-1\"}");

        for (var response : java.util.List.of(kakao, naverLogin, unknown)) {
            assertThat(response.getStatus()).isEqualTo(400);
            assertThat(mapper.readTree(response.getContentAsString()))
                    .isEqualTo(mapper.readTree("{\"detail\":\"unsupported_provider\"}"));
        }
        assertThat(naver.exchanges).as("꺼 둔 제공자에는 코드 교환을 하지 않는다").isEmpty();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM users", Integer.class)).isZero();
    }

    @Test
    @DisplayName("account.login: 설정이 없는 제공자의 연결 끊기 콜백은 503 이다 — 꺼 둔 것(400)과 달리 운영 사고다")
    void accountLogin_disconnectCallbackWithoutProviderSettingsIsNotConfigured() throws Exception {
        var naverCallback = mvc.perform(post("/v2/auth/providers/naver/disconnect")
                        .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                        .param("clientId", "x").param("encryptUniqueId", "y")
                        .param("timestamp", "1").param("signature", "z"))
                .andReturn().getResponse();
        var kakaoCallback = mvc.perform(post("/v2/auth/providers/kakao/disconnect")
                        .header("Authorization", "KakaoAK anything")
                        .param("app_id", "1").param("user_id", "2"))
                .andReturn().getResponse();

        for (var response : java.util.List.of(naverCallback, kakaoCallback)) {
            assertThat(response.getStatus()).isEqualTo(503);
            assertThat(mapper.readTree(response.getContentAsString()))
                    .isEqualTo(mapper.readTree("{\"detail\":\"provider_not_configured\"}"));
        }
    }

    private org.springframework.mock.web.MockHttpServletResponse login(String json) throws Exception {
        return mvc.perform(post("/v2/auth/login").contentType(MediaType.APPLICATION_JSON).content(json))
                .andReturn().getResponse();
    }
}
