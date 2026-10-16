package com.acttub.actingapi.feature.billing;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;

import com.acttub.actingapi.feature.billing.app.PgReviewGateway;
import com.acttub.actingapi.support.PostgresContainerSupport;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

/**
 * PG 심사 전용 테스트 결제(SOMA-620)를 실제 Spring 컨텍스트로 본다: 조건부 빈, 게이트 예외(클라이언트 판 헤더 없음),
 * 쿠키 세션, 공통 422 의 비밀번호 가림. 토스는 가짜 Port 이고 외부 호출은 없다.
 */
@SpringBootTest(properties = {
        "JWT_SECRET=test-secret",
        "ACTTUB_PG_REVIEW_ENABLED=true",
        "ACTTUB_PG_REVIEW_ORIGIN=https://review.acttub.test",
        "ACTTUB_PG_REVIEW_USERNAME=reviewer",
        "ACTTUB_PG_REVIEW_PASSWORD_SHA256=" + PgReviewEndpointIT.HASH,
        "ACTTUB_PG_REVIEW_TOSS_CLIENT_KEY=test_ck_fakefakefake1234",
        "ACTTUB_PG_REVIEW_TOSS_SECRET_KEY=test_sk_fakefakefake1234",
        // 토스 콜백은 클라이언트 판 헤더를 실을 수 없다 — 헤더 없이 부른다.
        "acttub.test.default-client-header=false"})
@AutoConfigureMockMvc
class PgReviewEndpointIT {
    static final String PASSWORD = "Review-Only-Password-4821";
    // SHA-256("Review-Only-Password-4821"). 테스트 전용 값이다.
    static final String HASH = "6f9b716960905872e3ed7bcf46b1d2fae237b17969bc55c95bae07ef6e61f36d";
    private static final String ORIGIN = "https://review.acttub.test";

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        String name = PostgresContainerSupport.createDatabaseName("pg_review");
        registry.add("spring.datasource.url", () -> PostgresContainerSupport.jdbcUrlFor(name));
        registry.add("spring.datasource.username", PostgresContainerSupport.POSTGRES::getUsername);
        registry.add("spring.datasource.password", PostgresContainerSupport.POSTGRES::getPassword);
    }

    @Autowired
    MockMvc mvc;

    @MockitoBean
    PgReviewGateway gateway;

    @Test
    void reviewFlowWorksWithoutAppAuthAndMasksTooLongPasswords() throws Exception {
        assertThat(sha256(PASSWORD)).isEqualTo(HASH);

        mvc.perform(get("/v2/pg-review/config"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.testOnly").value(true))
                .andExpect(jsonPath("$.amount").value(3900))
                .andExpect(jsonPath("$.authenticated").value(false));

        // 다른 /v2 경로는 여전히 클라이언트 판 헤더(426)로 막힌다.
        mvc.perform(get("/v2/me")).andExpect(status().is(426));

        // 공통 422: 128자 초과 비밀번호는 응답에 되돌아가지 않는다.
        String longPassword = "S3cret-" + "x".repeat(200);
        MvcResult tooLong = mvc.perform(post("/v2/pg-review/login")
                        .header("Origin", ORIGIN)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"username\":\"reviewer\",\"password\":\"" + longPassword + "\"}"))
                .andExpect(status().isUnprocessableEntity())
                .andReturn();
        String body = tooLong.getResponse().getContentAsString(StandardCharsets.UTF_8);
        assertThat(body).contains("string_too_long", "[redacted]").doesNotContain("S3cret", longPassword);

        // Origin 없이는 로그인할 수 없다.
        mvc.perform(post("/v2/pg-review/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"username\":\"reviewer\",\"password\":\"" + PASSWORD + "\"}"))
                .andExpect(status().isForbidden());

        // 틀린 비밀번호는 401 이고 쿠키가 없다.
        MvcResult wrong = mvc.perform(post("/v2/pg-review/login")
                        .header("Origin", ORIGIN)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"username\":\"reviewer\",\"password\":\"wrong-password\"}"))
                .andExpect(status().isUnauthorized())
                .andReturn();
        assertThat(wrong.getResponse().getHeader("Set-Cookie")).isNull();

        // 세션 없이 checkout/result 는 401.
        mvc.perform(post("/v2/pg-review/checkout").header("Origin", ORIGIN)).andExpect(status().isUnauthorized());
        mvc.perform(get("/v2/pg-review/result")).andExpect(status().isUnauthorized());

        // 맞는 로그인: 쿠키를 받고, 쿠키로 checkout 을 받는다.
        MvcResult login = mvc.perform(post("/v2/pg-review/login")
                        .header("Origin", ORIGIN)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"username\":\"reviewer\",\"password\":\"" + PASSWORD + "\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.authenticated").value(true))
                .andReturn();
        String setCookie = login.getResponse().getHeader("Set-Cookie");
        assertThat(setCookie).contains("HttpOnly", "Secure", "SameSite=Lax", "Path=/v2/pg-review");
        jakarta.servlet.http.Cookie session = new jakarta.servlet.http.Cookie(
                "acttub_pg_review", setCookie.substring(setCookie.indexOf('=') + 1, setCookie.indexOf(';')));

        mvc.perform(post("/v2/pg-review/checkout").header("Origin", ORIGIN).cookie(session))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.clientKey").value("test_ck_fakefakefake1234"))
                .andExpect(jsonPath("$.customerKey").value(org.hamcrest.Matchers.startsWith("pgr_")))
                .andExpect(jsonPath("$.successUrl").value(
                        org.hamcrest.Matchers.startsWith(ORIGIN + "/v2/pg-review/success?state=")));
        mvc.perform(get("/v2/pg-review/result").cookie(session))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("idle"));
        mvc.perform(get("/v2/pg-review/config").cookie(session))
                .andExpect(jsonPath("$.authenticated").value(true));

        // 콜백은 세션이 없어도 항상 깨끗한 결과 주소로 302 이고 게이트웨이를 부르지 않는다.
        MvcResult callback = mvc.perform(get("/v2/pg-review/success")
                        .param("state", "nope").param("customerKey", "nope").param("authKey", "AUTH-SECRET"))
                .andExpect(status().isFound())
                .andReturn();
        assertThat(callback.getResponse().getHeader("Location")).isEqualTo(ORIGIN + "/pg-review/result");
        assertThat(callback.getResponse().getHeader("Referrer-Policy")).isEqualTo("no-referrer");
        assertThat(callback.getResponse().getHeader("Cache-Control")).isEqualTo("no-store");
        verifyNoInteractions(gateway);
    }

    private static String sha256(String value) throws Exception {
        return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8)));
    }
}
