package com.acttub.actingapi.platform.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Supplier;

import com.acttub.actingapi.feature.auth.app.JwtService;
import tools.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.test.web.servlet.request.RequestPostProcessor;

/**
 * 한도(계정 분당 {@value AccessGate#PER_USER_PER_MINUTE}, IP 분당 60)를 넘긴 요청이 429 {@code rate limit exceeded} 로 거절되는지, <b>세 자리 전부</b>에서
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
 * <p>⚠ <b>IP 카운터는 지울 수 없다.</b> 카운터는 process-local 이라 {@code TRUNCATE} 로도 지워지지 않고,
 * 비우는 수단이 아예 없다 — 한때 {@code FixedWindowRateLimiter.reset()} 이 있었지만 하네스 제어 표면이라
 * `SOMA-403` 4단계에 함께 사라졌다. 컨텍스트를 같이 쓰는 다른 클래스도 127.0.0.1 로 로그인·갱신·가입을 보내므로,
 * IP 로 세는 케이스는 <b>케이스마다 처음 쓰는 방문자 주소</b>로 보낸다({@link #fromFreshAddress}).
 */
@SpringBootTest(properties = "JWT_SECRET=test-secret")
@AutoConfigureMockMvc
class RateLimitContractIT {

    /** 인증 라우터의 IP별 한도. */
    private static final int PER_IP = 60;

    /** IP 케이스마다 새 방문자 주소를 준다. 다른 테스트 클래스와 겹치지 않는 대역이다. */
    private static final AtomicInteger ADDRESSES = new AtomicInteger();

    /**
     * 고정 윈도우는 분 경계에서 카운터를 되돌리므로, 경계를 한 번 넘더라도 <b>반드시</b> 한도를
     * 넘기려면 한도의 두 배보다 많이 보내야 한다. 한도 + 1 회만 보내면 경계에 걸친 실행에서만
     * 초록이 아닌 flaky 가 된다.
     */
    private static int enoughToCrossAnyWindow(int limit) {
        return limit * 2 + 1;
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
    void theRateLimitedGateRejectsTheRequestPastTheLimitOfAUser() throws Exception {
        UUID userId = insertUser();
        assertRejectedAfterTheLimit(AccessGate.PER_USER_PER_MINUTE, () -> get("/v2/me")
                .header("Authorization", bearer(userId)));
    }

    /**
     * 로그아웃은 <b>인증한 뒤</b> 주체별로 센다. 토큰이 유효하기만 하면 본문이 무엇이든 세는
     * 자리까지 도달한다 — 그래서 401 이 한도만큼 나오다 그다음이 429 다.
     */
    @Test
    void theAuthRouterCountsPerUserAfterAuthenticating() throws Exception {
        UUID userId = insertUser();
        assertRejectedAfterTheLimit(AccessGate.PER_USER_PER_MINUTE, () -> post("/v2/auth/logout")
                .header("Authorization", bearer(userId))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"refresh_token\":\"없는 토큰\"}"));
    }

    /** 갱신은 인증 이전에 IP 로 센다 — 토큰이 틀려도 카운터는 오른다. */
    @Test
    void theAuthRouterCountsPerIpBeforeItLooksAtTheToken() throws Exception {
        RequestPostProcessor address = fromFreshAddress();
        assertRejectedAfterTheLimit(PER_IP, () -> post("/v2/auth/refresh")
                .with(address)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"refresh_token\":\"없는 토큰\"}"));
    }

    /**
     * account.login: 가입 제출은 주체가 없는 요청이라 IP 로 센다 — 로그인·갱신과 <b>다른 키</b>다. 갱신 케이스와 같은
     * 주소로 갱신을 한도까지 보낸 뒤에도 가입은 처음부터 센다. 가입 토큰이 틀려도 카운터는 오른다.
     */
    @Test
    void signupCountsPerIpOnItsOwnBucket() throws Exception {
        RequestPostProcessor address = fromFreshAddress();
        assertRejectedAfterTheLimit(PER_IP, () -> post("/v2/auth/refresh")
                .with(address)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"refresh_token\":\"없는 토큰\"}"));
        assertRejectedAfterTheLimit(PER_IP, () -> post("/v2/auth/signup")
                .with(address)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"signup_token\":\"없는 토큰\",\"decisions\":[]}"));
    }

    private void assertRejectedAfterTheLimit(
            int limit, Supplier<MockHttpServletRequestBuilder> request)
            throws Exception {
        int enough = enoughToCrossAnyWindow(limit);
        for (int attempt = 1; attempt <= enough; attempt++) {
            var response = mvc.perform(request.get()).andReturn().getResponse();
            if (response.getStatus() == 429) {
                assertThat(mapper.readTree(response.getContentAsString()))
                        .isEqualTo(mapper.readTree("{\"detail\":\"rate limit exceeded\"}"));
                assertThat(attempt)
                        .as("한도 %d 을 넘기기 전에 거절됐다", limit)
                        .isGreaterThan(limit);
                return;
            }
        }
        throw new AssertionError(
                enough + " 회를 보내도 429 가 나오지 않았다");
    }

    private static RequestPostProcessor fromFreshAddress() {
        String address = "10.71.0." + ADDRESSES.incrementAndGet();
        return request -> {
            request.setRemoteAddr(address);
            return request;
        };
    }

    private UUID insertUser() {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO users(id, status) VALUES (?, 'active')", id);
        return id;
    }

    private String bearer(UUID userId) {
        return "Bearer " + jwt.issueAccessToken(userId).value();
    }
}
