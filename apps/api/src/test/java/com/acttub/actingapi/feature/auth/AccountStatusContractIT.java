package com.acttub.actingapi.feature.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import java.util.UUID;

import com.acttub.actingapi.feature.auth.app.AuthService;
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
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

/**
 * 쓸 수 없는 계정을 막는 403 이 <b>네 진입 경로 전부</b>에서 나는지 본다.
 *
 * <p><b>계약 하네스에서 옮겨 온 기대값이다</b>(SOMA-403 2단계). 하네스는 이것을 여섯 케이스로
 * 갖고 있었다 — 파이썬은 판정이 {@code auth/dependencies.py} 와 {@code auth/router.py} 두 벌로
 * 갈려 있었기 때문이다. Java 는 {@code AuthenticatedUser.requireUsable} 한 자리로 합쳤지만,
 * <b>합쳤다는 사실이 경로마다 그것을 부른다는 보장은 아니다.</b> 실제로 파이썬에서 로그인 쪽만
 * {@code deactivated} 를 빠뜨려 탈퇴 계정이 다시 로그인된 사고가 있었고(SOMA-306 흡수 누락),
 * 그 자리를 지키는 것이 이 테스트다. 인벤토리 검사기는 {@code new ApiException} 지점만 세므로
 * 호출이 빠진 것을 보지 못한다.
 *
 * <p>로그인은 {@code development} 프로바이더로 민다 — 실물 검증기와 같은 경로를 밟으면서
 * 외부 호출이 없고, {@code user_identities.provider} 가 허용하는 이름이라 신원 행을 심을 수 있다.
 * 이 검증기는 이메일을 <b>항상 미검증</b>으로 내므로 계정 충돌 409 도 같은 경로로 만들어진다.
 */
@SpringBootTest(properties = {"JWT_SECRET=test-secret", "DEVELOPMENT_AUTH_PROVIDER=1"})
@AutoConfigureMockMvc
class AccountStatusContractIT {
    private static final UUID DEACTIVATED =
            UUID.fromString("00000000-0000-4000-8000-000000000602");
    private static final UUID SETTLED =
            UUID.fromString("00000000-0000-4000-8000-000000000603");

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        String name = PostgresContainerSupport.createDatabaseName("account_status");
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
    AuthService auth;

    @Autowired
    ObjectMapper mapper;

    @BeforeEach
    void setUp() {
        jdbc.execute("TRUNCATE TABLE users, consent_documents RESTART IDENTITY CASCADE");
        insertUser(DEACTIVATED, "deactivated", null, "deactivated");
    }

    /** 액세스 토큰을 요구하는 경로. 토큰은 멀쩡하고 계정만 못 쓰는 상태다. */
    @Test
    void tokenBackedRoutesRejectDeactivatedAccounts() throws Exception {
        assertError(get("/v2/me").header("Authorization", bearer(DEACTIVATED)),
                403, "account_deactivated");
    }

    /**
     * 인증이 <b>선택</b>인 경로도 같다. 헤더가 오면 읽고, 읽었으면 상태를 본다 — 헤더가 없을
     * 때만 익명으로 지나간다.
     */
    @Test
    void optionalAuthRoutesStillRejectThemButStayOpenToAnonymous() throws Exception {
        assertError(get("/v2/community/posts").header("Authorization", bearer(DEACTIVATED)),
                403, "account_deactivated");

        assertThat(mvc.perform(get("/v2/community/posts")).andReturn().getResponse().getStatus())
                .isEqualTo(200);
    }

    /** 이미 신원이 연결된 계정으로 다시 로그인해도 상태 검사를 통과하지 못한다. */
    @Test
    void loginRejectsThemEvenWhenTheIdentityIsAlreadyLinked() throws Exception {
        linkIdentity(DEACTIVATED, "dev-deactivated");

        assertError(login("dev-deactivated"), 403, "account_deactivated");
    }

    /** 갱신 경로. 토큰이 유효해도 계정이 못 쓰는 상태면 401 이 아니라 403 이다. */
    @Test
    void refreshRejectsThemWithForbiddenRatherThanInvalidToken() throws Exception {
        String deactivated = issueRefreshFor(DEACTIVATED);

        assertError(post("/v2/auth/refresh")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"refresh_token\":\"" + deactivated + "\"}"),
                403, "account_deactivated");
    }

    /**
     * 검증되지 않은 이메일로 남의 계정에 붙는 것을 막는 409.
     *
     * <p>이것이 없으면 <b>주소를 대는 것만으로</b> 이미 있는 계정에 들어간다. development
     * 검증기는 이메일을 늘 미검증으로 내므로 그 분기가 그대로 열린다.
     */
    @Test
    void loginWithAnUnverifiedEmailThatAlreadyBelongsToSomeoneIsAConflict() throws Exception {
        insertUser(SETTLED, "settled", "taken@example.test", "active");

        assertError(login("dev-newcomer:taken@example.test"),
                409, "account_exists_with_different_provider");
    }

    private MockHttpServletRequestBuilder login(String idToken) {
        return post("/v2/auth/login")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"provider\":\"development\",\"id_token\":\"" + idToken + "\"}");
    }

    /**
     * {@code issueTokens} 는 상태를 보지 않는다 — 발급은 이미 로그인한 사람에게 하는 일이고,
     * 계정이 못 쓰게 된 것은 그 뒤의 일이다. 그래서 못 쓰는 계정으로도 저장된 refresh 를 만들 수
     * 있고, 그것이 실제 상황과 같다(탈퇴는 이미 발급된 토큰을 회수하지 않는다).
     */
    private String issueRefreshFor(UUID userId) {
        return auth.issueTokens(userId, "contract-test").refreshToken();
    }

    private String bearer(UUID userId) {
        return "Bearer " + jwt.issueAccessToken(userId).value();
    }

    private void assertError(
            MockHttpServletRequestBuilder request, int status, String detail) throws Exception {
        MvcResult result = mvc.perform(request).andReturn();
        assertThat(result.getResponse().getStatus())
                .as("기대한 상태코드 %d, detail=%s", status, detail)
                .isEqualTo(status);
        assertThat(mapper.readTree(result.getResponse().getContentAsString()))
                .isEqualTo(mapper.readTree("{\"detail\":\"" + detail + "\"}"));
    }

    private void insertUser(UUID id, String nickname, String email, String status) {
        jdbc.update("""
                INSERT INTO users(id, email, nickname, status)
                VALUES (?, ?, ?, ?)
                """, id, email, nickname, status);
    }

    private void linkIdentity(UUID userId, String providerUid) {
        jdbc.update("""
                INSERT INTO user_identities(id, user_id, provider, provider_uid)
                VALUES (?, ?, 'development', ?)
                """, UUID.randomUUID(), userId, providerUid);
    }
}
