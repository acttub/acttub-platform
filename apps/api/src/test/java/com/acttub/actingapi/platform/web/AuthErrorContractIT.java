package com.acttub.actingapi.platform.web;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import java.util.UUID;

import com.acttub.actingapi.feature.auth.app.JwtService;
import com.acttub.actingapi.integration.oidc.ProviderConfigurationError;
import com.acttub.actingapi.platform.observability.FailureKind;
import com.acttub.actingapi.support.PostgresContainerSupport;
import com.acttub.actingapi.support.RecordingFailureReporter;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

@SpringBootTest(properties = {
        "JWT_SECRET=test-secret",
        // 로그인 입구의 세 갈래를 외부 호출 없이 만든다: development 는 빈 토큰을 거절하고,
        // client id 를 비운 google 은 디코더를 만들기도 전에 설정 오류를 낸다.
        "DEVELOPMENT_AUTH_PROVIDER=1",
        "GOOGLE_OAUTH_CLIENT_ID="})
@AutoConfigureMockMvc
@Import(AuthErrorContractIT.FailureReporterFixture.class)
class AuthErrorContractIT {
    private static final ObjectMapper JSON = new ObjectMapper();

    @DynamicPropertySource
    static void db(DynamicPropertyRegistry registry) {
        String name = PostgresContainerSupport.createDatabaseName("auth_error");
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
    RecordingFailureReporter failureReporter;

    @Test
    void inventoryUsesDetailAndNeverProblemDetail() throws Exception {
        assertResponse(get("/missing"), 404, "{\"detail\":\"Not Found\"}");
        assertResponse(get("/v2/auth/login"), 405, "{\"detail\":\"Method Not Allowed\"}");
        assertResponse(
                post("/v2/auth/logout")
                        .contentType("application/json")
                        .content("{\"refresh_token\":\"x\"}"),
                401,
                "{\"detail\":\"invalid or missing access token\"}");
        assertResponse(
                post("/v2/auth/login")
                        .contentType("application/json")
                        .content("{\"provider\":\"none\",\"id_token\":\"x\"}"),
                400,
                "{\"detail\":\"unsupported_provider\"}");
    }

    /**
     * 로그인 입구의 세 갈래. <b>모르는 프로바이더(400) · 못 믿을 토큰(401) · 설정되지 않은
     * 프로바이더(503)</b>가 각각 다른 코드다.
     *
     * <p><b>계약 하네스에서 옮겨 온 기대값이다</b>(SOMA-403 2단계). 뒤의 둘을 단언하던 곳이
     * {@code HarnessContractProfileIT} 뿐이었고, 그것은 4단계에서 하네스와 함께 사라졌다.
     * <b>지금 이 셋을 지키는 것은 여기뿐이다.</b>
     */
    @Test
    void loginSeparatesUnknownProviderUntrustedTokenAndMissingConfiguration() throws Exception {
        int reportsBefore = failureReporter.reports().size();

        assertResponse(login("none", "무엇이든"), 400, "{\"detail\":\"unsupported_provider\"}");
        assertResponse(login("development", ""), 401,
                "{\"detail\":\"invalid_provider_token\"}");
        assertThat(failureReporter.reports()).hasSize(reportsBefore);

        assertResponse(login("google", "무엇이든"), 503,
                "{\"detail\":\"provider_not_configured\"}");
        assertThat(failureReporter.reports()).hasSize(reportsBefore + 1);
        assertThat(failureReporter.reports().get(reportsBefore)).satisfies(report -> {
            assertThat(report.failure()).isInstanceOf(ProviderConfigurationError.class);
            assertThat(report.kind()).isEqualTo(FailureKind.UNEXPECTED);
            assertThat(report.context()).isEqualTo("ApiErrorAdvice.apiException");
        });
    }

    private static MockHttpServletRequestBuilder login(String provider, String idToken) {
        return post("/v2/auth/login")
                .contentType("application/json")
                .content("{\"provider\":\"" + provider + "\",\"id_token\":\"" + idToken + "\"}");
    }

    /**
     * 갱신·로그아웃이 거절하는 이유는 여럿이지만 <b>응답은 하나</b>다 — 어느 단계에서 걸렸는지
     * 알려주면 토큰을 가진 쪽이 그것을 단서로 쓴다.
     *
     * <p><b>계약 하네스에서 옮겨 온 기대값이다</b>(SOMA-403 2단계). 이 문자열을 단언하던 유일한
     * 테스트가 {@code FastApiInteropIT} 였는데, 그것은 실행 중인 FastAPI 를 요구해
     * <b>5단계에서 파이썬과 함께 사라진다.</b> {@code RefreshRotationIT} 는 401 이라는 것만 보고
     * detail 은 보지 않는다.
     */
    @Test
    void refreshAndLogoutCollapseEveryRejectionIntoOneInvalidTokenResponse() throws Exception {
        UUID userId = UUID.randomUUID();
        jdbc.update("INSERT INTO users(id,status) VALUES (?,'active')", userId);

        assertResponse(
                post("/v2/auth/refresh")
                        .contentType("application/json")
                        .content("{\"refresh_token\":\"서명이 아닌 문자열\"}"),
                401,
                "{\"detail\":\"invalid_refresh_token\"}");

        // 서명은 멀쩡하지만 저장된 적이 없는 토큰. 앞의 것과 이유가 다른데 응답은 같아야 한다.
        String unstored = jwt.issueRefreshToken(userId).value();
        assertResponse(
                post("/v2/auth/refresh")
                        .contentType("application/json")
                        .content("{\"refresh_token\":\"" + unstored + "\"}"),
                401,
                "{\"detail\":\"invalid_refresh_token\"}");

        assertResponse(
                post("/v2/auth/logout")
                        .header("Authorization", "Bearer " + jwt.issueAccessToken(userId).value())
                        .contentType("application/json")
                        .content("{\"refresh_token\":\"" + unstored + "\"}"),
                401,
                "{\"detail\":\"invalid_refresh_token\"}");
    }

    @Test
    void validationHasFastApiLocMsgAndTypeForMissingWrongAndMalformed() throws Exception {
        assertThat(body(jsonPost("{}"), 422)).isEqualTo(JSON.readTree("""
                {"detail":[
                  {"type":"missing","loc":["body","provider"],"msg":"Field required","input":{}},
                  {"type":"missing","loc":["body","id_token"],"msg":"Field required","input":{}}
                ]}
                """));

        assertThat(body(jsonPost("{\"provider\":1,\"id_token\":\"a\"}"), 422))
                .isEqualTo(JSON.readTree("""
                        {"detail":[{"type":"string_type","loc":["body","provider"],
                          "msg":"Input should be a valid string","input":1}]}
                        """));

        assertThat(body(jsonPost(""), 422)).isEqualTo(JSON.readTree("""
                {"detail":[{"type":"missing","loc":["body"],
                  "msg":"Field required","input":null}]}
                """));

        assertMalformedJson(body(jsonPost("{\"provider\": \"google\", "), 422));
    }

    private static void assertMalformedJson(JsonNode response) {
        assertThat(response.path("detail")).hasSize(1);
        JsonNode error = response.path("detail").get(0);
        assertThat(error.path("type").textValue()).isEqualTo("json_invalid");
        assertThat(error.path("msg").textValue()).isEqualTo("JSON decode error");
        assertThat(error.path("loc")).hasSize(2);
        assertThat(error.path("loc").get(0).textValue()).isEqualTo("body");
        assertThat(error.path("loc").get(1).isIntegralNumber()).isTrue();
        assertThat(error.path("input").isObject()).isTrue();
        assertThat(error.path("input")).isEmpty();
        assertThat(error.path("ctx").path("error").isTextual()).isTrue();
        assertThat(error.path("ctx").path("error").textValue()).isNotBlank();
    }

    private static MockHttpServletRequestBuilder jsonPost(String body) {
        return post("/v2/auth/login").contentType("application/json").content(body);
    }

    private void assertResponse(
            MockHttpServletRequestBuilder request,
            int status,
            String expected) throws Exception {
        MvcResult result = mvc.perform(request).andReturn();
        assertThat(result.getResponse().getStatus()).isEqualTo(status);
        assertThat(JSON.readTree(result.getResponse().getContentAsString()))
                .isEqualTo(JSON.readTree(expected));
    }

    private JsonNode body(MockHttpServletRequestBuilder request, int status) throws Exception {
        MvcResult result = mvc.perform(request).andReturn();
        assertThat(result.getResponse().getStatus()).isEqualTo(status);
        return JSON.readTree(result.getResponse().getContentAsString());
    }

    @TestConfiguration(proxyBeanMethods = false)
    static class FailureReporterFixture {
        @Bean
        @Primary
        RecordingFailureReporter recordingFailureReporter() {
            return new RecordingFailureReporter();
        }
    }
}
