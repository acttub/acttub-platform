package com.acttub.actingapi.feature.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.UUID;

import com.acttub.actingapi.feature.auth.app.AuthService;
import com.acttub.actingapi.support.AccountFixtures;
import com.acttub.actingapi.support.PostgresContainerSupport;
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

/**
 * account.logout 의 "검증 방법" 가운데 서버의 몫을 HTTP 와 실제 Postgres 로 본다. 기기의 토큰 삭제, 리마인드
 * 알람, 마지막 제공자 강조, 비행기 모드는 앱 갈래가 본다. 그 기기의 푸시 토큰 삭제는 앱이 로그아웃의 첫
 * 단계로 따로 부르는 API 이고 {@code AccountNotificationIT} 가 본다.
 */
@SpringBootTest(properties = {"JWT_SECRET=test-secret", "ACCOUNT_CLEANUP_ENABLED=false"})
@AutoConfigureMockMvc
class AccountLogoutIT {

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        String name = PostgresContainerSupport.createDatabaseName("account_logout");
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
    AuthService auth;

    private UUID member;

    @BeforeEach
    void setUp() {
        jdbc.execute("TRUNCATE TABLE users,consent_documents RESTART IDENTITY CASCADE");
        jdbc.update("""
                INSERT INTO consent_documents(id,type,version,title,body,required,published_at)
                VALUES (?,'terms','v1','약관','본문',true,?)
                """, UUID.randomUUID(), OffsetDateTime.of(2026, 10, 1, 0, 0, 0, 0, ZoneOffset.UTC));
        member = user();
        AccountFixtures.passGate(jdbc, member);
    }

    @Test
    @DisplayName("account.logout: 폰 두 대에 로그인하고 한 대에서 로그아웃 — 그 기기의 refresh_tokens 행에 revoked_at 이 있고 다른 기기 행은 그대로다. 다른 폰은 토큰 갱신도 된다")
    void accountLogout_endsOnlyThisDevicesSession() throws Exception {
        AuthService.TokenPair phone = auth.issueTokens(member, "phone");
        AuthService.TokenPair tablet = auth.issueTokens(member, "tablet");

        var response = logout(phone.accessToken(), phone.refreshToken());

        assertThat(response.getStatus()).isEqualTo(204);
        assertThat(response.getContentAsString()).isEmpty();
        assertThat(jdbc.queryForObject(
                "SELECT revoked_at IS NOT NULL FROM refresh_tokens WHERE device_info='phone'", Boolean.class)).isTrue();
        assertThat(jdbc.queryForObject(
                "SELECT revoked_at IS NULL FROM refresh_tokens WHERE device_info='tablet'", Boolean.class)).isTrue();

        assertThat(refresh(tablet.refreshToken()).getStatus()).as("다른 기기는 영향이 없다").isEqualTo(200);
        var again = refresh(phone.refreshToken());
        assertThat(again.getStatus()).as("로그아웃 뒤 옛 리프레시 토큰으로 갱신 — 401").isEqualTo(401);
        assertThat(mapper.readTree(again.getContentAsString()))
                .isEqualTo(mapper.readTree("{\"detail\":\"invalid_refresh_token\"}"));
    }

    @Test
    @DisplayName("account.logout: 같은 리프레시 토큰으로 로그아웃을 두 번 — 둘 다 204. 모르는 토큰과 위조된 토큰도 같은 204 다")
    void accountLogout_isIdempotent() throws Exception {
        AuthService.TokenPair phone = auth.issueTokens(member, "phone");

        assertThat(logout(phone.accessToken(), phone.refreshToken()).getStatus()).isEqualTo(204);
        assertThat(logout(phone.accessToken(), phone.refreshToken()).getStatus()).isEqualTo(204);
        assertThat(logout(phone.accessToken(), "not-a-token").getStatus()).isEqualTo(204);

        AuthService.TokenPair gone = auth.issueTokens(member, "gone");
        jdbc.update("DELETE FROM refresh_tokens WHERE device_info='gone'");
        assertThat(logout(phone.accessToken(), gone.refreshToken()).getStatus()).isEqualTo(204);
    }

    @Test
    @DisplayName("account.logout: 남의 리프레시 토큰으로 로그아웃 — 204 이고 그 토큰은 폐기되지 않았다")
    void accountLogout_someoneElsesTokenIsLeftAlone() throws Exception {
        UUID other = user();
        AuthService.TokenPair mine = auth.issueTokens(member, "mine");
        AuthService.TokenPair theirs = auth.issueTokens(other, "theirs");

        var response = logout(mine.accessToken(), theirs.refreshToken());

        assertThat(response.getStatus()).isEqualTo(204);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM refresh_tokens WHERE revoked_at IS NOT NULL", Integer.class))
                .as("아무것도 폐기하지 않는다").isZero();
        assertThat(refresh(theirs.refreshToken()).getStatus()).isEqualTo(200);
    }

    @Test
    @DisplayName("account.logout: 동의를 아직 결정하지 않은 상태에서 로그아웃 — 204 다(게이트 밖)")
    void accountLogout_isOutsideTheGate() throws Exception {
        UUID undecided = user();
        AuthService.TokenPair tokens = auth.issueTokens(undecided, "phone");

        assertThat(logout(tokens.accessToken(), tokens.refreshToken()).getStatus()).isEqualTo(204);
        assertThat(jdbc.queryForObject(
                "SELECT revoked_at IS NOT NULL FROM refresh_tokens WHERE user_id=?", Boolean.class, undecided)).isTrue();
    }

    @Test
    @DisplayName("account.logout: 본문에 리프레시 토큰이 없으면 422 배열이고, 액세스 토큰이 없으면 401 이다")
    void accountLogout_stillNeedsTheBodyAndTheAccessToken() throws Exception {
        AuthService.TokenPair phone = auth.issueTokens(member, "phone");

        var noBody = mvc.perform(post("/v2/auth/logout")
                        .header("Authorization", "Bearer " + phone.accessToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andReturn().getResponse();
        var noToken = mvc.perform(post("/v2/auth/logout")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"refresh_token\":\"" + phone.refreshToken() + "\"}"))
                .andReturn().getResponse();

        assertThat(noBody.getStatus()).isEqualTo(422);
        assertThat(mapper.readTree(noBody.getContentAsString()).path("detail").isArray()).isTrue();
        assertThat(noToken.getStatus()).isEqualTo(401);
    }

    private UUID user() {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO users(id,status) VALUES (?,'active')", id);
        jdbc.update("INSERT INTO user_identities(id,user_id,provider,provider_uid) VALUES (?,?,'google',?)",
                UUID.randomUUID(), id, "g-" + id);
        return id;
    }

    private MockHttpServletResponse logout(String accessToken, String refreshToken) throws Exception {
        return mvc.perform(post("/v2/auth/logout")
                        .header("Authorization", "Bearer " + accessToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"refresh_token\":\"" + refreshToken + "\"}"))
                .andReturn().getResponse();
    }

    private MockHttpServletResponse refresh(String refreshToken) throws Exception {
        return mvc.perform(post("/v2/auth/refresh")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"refresh_token\":\"" + refreshToken + "\"}"))
                .andReturn().getResponse();
    }
}
