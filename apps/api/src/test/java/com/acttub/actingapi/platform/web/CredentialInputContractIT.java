package com.acttub.actingapi.platform.web;

import static org.assertj.core.api.Assertions.assertThat;

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
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders;

/**
 * 자격 값은 422 의 {@code input} 으로 되돌려 보내지 않는다 (apps/api/CONTRACT.md §6-6).
 *
 * <p>본문의 모양이 틀린 422 는 받은 값을 {@code input} 에 싣는다. 빠진 칸의 {@code input} 은 본문 전체라,
 * 다른 칸 하나가 빠졌을 뿐인 요청이 토큰·코드를 응답(과 그것을 찍는 클라이언트 로그·오류 수집)으로 되돌린다.
 */
@SpringBootTest(properties = {"JWT_SECRET=test-secret", "ACCOUNT_CLEANUP_ENABLED=false"})
@AutoConfigureMockMvc
class CredentialInputContractIT {

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        String name = PostgresContainerSupport.createDatabaseName("credential_input");
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

    private String bearer;

    @BeforeEach
    void setUp() {
        jdbc.execute("TRUNCATE TABLE users,consent_documents RESTART IDENTITY CASCADE");
        UUID member = UUID.randomUUID();
        jdbc.update("INSERT INTO users(id,status) VALUES (?,'active')", member);
        jdbc.update("INSERT INTO user_identities(id,user_id,provider,provider_uid) VALUES (?,?,'google',?)",
                UUID.randomUUID(), member, "g-" + member);
        AccountFixtures.passGate(jdbc, member);
        bearer = "Bearer " + jwt.issueAccessToken(member).value();
    }

    @Test
    @DisplayName("account.login: provider 만 빠진 로그인의 422 는 id_token·authorization_code·code_verifier 를 되돌려 보내지 않는다")
    void accountLogin_aLoginMissingItsProviderDoesNotEchoTheCredentials() throws Exception {
        var response = post("/v2/auth/login", """
                {"id_token":"SECRET-id-token","authorization_code":"SECRET-code","code_verifier":"SECRET-verifier",
                 "redirect_uri":"actingapp://auth/naver","state":"SECRET-state"}
                """, null);

        JsonNode missing = onlyError(response, "missing", "provider");
        assertThat(response.getContentAsString()).doesNotContain("SECRET");
        assertThat(missing.path("input")).as("자격 값을 뺀 본문 — 남는 칸이 없다").isEqualTo(mapper.readTree("{}"));
    }

    @Test
    @DisplayName("account.login: 이름을 잘못 쓴 키(idToken)에 실려 온 토큰도 되돌려 보내지 않고, 자격 값이 아닌 칸은 그대로 싣는다")
    void accountLogin_aMisspelledCredentialKeyIsNotEchoedEither() throws Exception {
        var login = post("/v2/auth/login", "{\"idToken\":\"SECRET-id-token\"}", null);
        var push = post("/v2/push-tokens", "{\"pushToken\":\"SECRET-push-token\",\"platform\":\"ios\"}", bearer);

        onlyError(login, "missing", "provider");
        assertThat(login.getContentAsString() + push.getContentAsString()).doesNotContain("SECRET");
        JsonNode missingToken = mapper.readTree(push.getContentAsString()).path("detail").get(0);
        assertThat(missingToken.path("loc")).extracting(JsonNode::textValue).containsExactly("body", "token");
        assertThat(missingToken.path("input")).isEqualTo(mapper.readTree("{\"platform\":\"ios\"}"));
    }

    @Test
    @DisplayName("account.login: 자격 칸 자체의 모양이 틀린 422 도 그 값을 되돌려 보내지 않는다")
    void accountLogin_aMalformedCredentialIsNotEchoedEither() throws Exception {
        var response = post("/v2/auth/login", """
                {"provider":"google","id_token":["SECRET-id-token"]}
                """, null);

        assertThat(response.getStatus()).isEqualTo(422);
        assertThat(response.getContentAsString()).doesNotContain("SECRET");
        assertThat(mapper.readTree(response.getContentAsString()).path("detail").get(0).path("loc"))
                .extracting(JsonNode::textValue).containsExactly("body", "id_token");
    }

    @Test
    @DisplayName("account.login: 결정이 빠진 가입 제출의 422 는 가입 토큰을 되돌려 보내지 않는다")
    void accountLogin_aSignupMissingItsDecisionsDoesNotEchoTheSignupToken() throws Exception {
        var response = post("/v2/auth/signup", "{\"signup_token\":\"SECRET-signup-token\"}", null);

        onlyError(response, "missing", "decisions");
        assertThat(response.getContentAsString()).doesNotContain("SECRET");
    }

    @Test
    @DisplayName("account.logout: 갱신·로그아웃의 422 는 리프레시 토큰을 되돌려 보내지 않는다")
    void accountLogout_refreshAndLogoutDoNotEchoTheRefreshToken() throws Exception {
        var refresh = post("/v2/auth/refresh", "{\"refresh_token\":[\"SECRET-refresh-token\"]}", null);
        var logout = post("/v2/auth/logout", "{\"refresh_token\":{\"value\":\"SECRET-refresh-token\"}}", bearer);

        assertThat(refresh.getStatus()).isEqualTo(422);
        assertThat(logout.getStatus()).isEqualTo(422);
        assertThat(refresh.getContentAsString() + logout.getContentAsString()).doesNotContain("SECRET");
    }

    @Test
    @DisplayName("account.guest: 모양이 틀린 이관 코드의 422 는 그 코드를 되돌려 보내지 않는다")
    void accountGuest_aMalformedTransferCodeIsNotEchoed() throws Exception {
        var sevenDigits = post("/v2/guest-transfers", "{\"code\":\"9876543\"}", bearer);
        var number = post("/v2/guest-transfers", "{\"code\":987654}", bearer);
        var badChoice = post("/v2/guest-transfers", "{\"code\":\"987654\",\"memory_choice\":\"both\"}", bearer);

        for (MockHttpServletResponse response : java.util.List.of(sevenDigits, number, badChoice)) {
            assertThat(response.getStatus()).as(response.getContentAsString()).isEqualTo(422);
            assertThat(response.getContentAsString()).doesNotContain("98765");
        }
    }

    @Test
    @DisplayName("account.notification: platform 이 빠진 푸시 토큰 등록의 422 는 푸시 토큰을 되돌려 보내지 않는다")
    void accountNotification_aRegistrationMissingItsPlatformDoesNotEchoThePushToken() throws Exception {
        var response = post("/v2/push-tokens", "{\"token\":\"ExponentPushToken[SECRET]\"}", bearer);

        onlyError(response, "missing", "platform");
        assertThat(response.getContentAsString()).doesNotContain("SECRET");
    }

    private JsonNode onlyError(MockHttpServletResponse response, String type, String field) throws Exception {
        assertThat(response.getStatus()).as(response.getContentAsString()).isEqualTo(422);
        JsonNode detail = mapper.readTree(response.getContentAsString()).path("detail");
        assertThat(detail).hasSize(1);
        assertThat(detail.get(0).path("type").textValue()).isEqualTo(type);
        assertThat(detail.get(0).path("loc")).extracting(JsonNode::textValue).containsExactly("body", field);
        return detail.get(0);
    }

    private MockHttpServletResponse post(String path, String body, String authorization) throws Exception {
        var request = MockMvcRequestBuilders.post(path).contentType(MediaType.APPLICATION_JSON).content(body);
        if (authorization != null) {
            request.header("Authorization", authorization);
        }
        return mvc.perform(request).andReturn().getResponse();
    }
}
