package com.acttub.actingapi.platform.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.auth.app.JwtService;
import com.acttub.actingapi.support.AccountFixtures;
import com.acttub.actingapi.support.PostgresContainerSupport;
import com.fasterxml.jackson.databind.ObjectMapper;
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
 * 공통 규칙: 클라이언트 판 헤더 없는 {@code /v2} 요청은 426 과 업데이트 안내 문장이다.
 *
 * <p>다른 테스트는 1.0.0 앱처럼 헤더를 기본으로 싣는다({@code DefaultClientHeader}). 여기만 그것을
 * 끄고 헤더가 <b>없는</b> 요청을 본다.
 */
@SpringBootTest(properties = {
        "JWT_SECRET=test-secret",
        "ADMIN_OPS_TOKEN=ops-token",
        "acttub.test.default-client-header=false"})
@AutoConfigureMockMvc
class ClientVersionContractIT {
    private static final String UPGRADE = "{\"detail\":\"새 버전이 나왔어요. 스토어에서 업데이트해 주세요.\"}";

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        String name = PostgresContainerSupport.createDatabaseName("client_version");
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

    @Test
    void requestsWithoutTheClientHeaderGetTheUpgradeNoticeBeforeAnyOtherJudgement() throws Exception {
        UUID member = member();
        List<MockHttpServletRequestBuilder> oldBuilds = List.of(
                // 연습 API — 토큰이 멀쩡해도.
                get("/v2/practice-sessions").header("Authorization", bearer(member)),
                // 토큰이 틀려도 401 이 아니다. 옛 빌드가 로그인 화면으로 돌아가면 안내를 보지 못한다.
                get("/v2/practice-sessions").header("Authorization", "Bearer expired"),
                get("/v2/me"),
                get("/v2/consents/documents"),
                get("/v2/admissions"),
                get("/v2/no-such-route"),
                post("/v2/auth/login").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"provider\":\"google\",\"id_token\":\"x\"}"),
                post("/v2/auth/refresh").contentType(MediaType.APPLICATION_JSON).content("{}"),
                get("/v2/practice-sessions").header("X-Acttub-Client", "  "));

        for (MockHttpServletRequestBuilder request : oldBuilds) {
            var response = mvc.perform(request).andReturn().getResponse();
            assertThat(response.getStatus()).isEqualTo(426);
            assertThat(mapper.readTree(response.getContentAsString()))
                    .as("1.0.0 이전 앱은 모르는 상태 코드에 실린 문장을 그대로 보여 준다")
                    .isEqualTo(mapper.readTree(UPGRADE));
        }
    }

    @Test
    void appAndWebBuildsThatSendTheHeaderAreJudgedAsUsual() throws Exception {
        UUID member = member();
        for (String client : List.of("app/1.0.0", "web/1.0.0")) {
            assertThat(mvc.perform(get("/v2/practice-sessions")
                            .header("X-Acttub-Client", client)
                            .header("Authorization", bearer(member)))
                    .andReturn().getResponse().getStatus()).as(client).isEqualTo(200);
            assertThat(mvc.perform(get("/v2/practice-sessions")
                            .header("X-Acttub-Client", client)
                            .header("Authorization", "Bearer expired"))
                    .andReturn().getResponse().getStatus()).as(client).isEqualTo(401);
        }
    }

    @Test
    void healthCheckProviderCallbacksAndOperatorRoutesAreNotAppBuilds() throws Exception {
        assertThat(mvc.perform(get("/health")).andReturn().getResponse().getStatus()).isEqualTo(200);

        // 네이버·카카오는 우리 헤더를 모른다. 콜백은 헤더 때문에 막히지 않는다.
        for (String callback : List.of(
                "/v2/auth/providers/naver/disconnect", "/v2/auth/providers/kakao/disconnect")) {
            assertThat(mvc.perform(post(callback)).andReturn().getResponse().getStatus())
                    .as(callback).isNotEqualTo(426);
        }

        // 운영 토큰으로 여는 운영 도구의 경로다.
        assertThat(mvc.perform(get("/v2/admin/sessions").header("Authorization", "Bearer ops-token"))
                .andReturn().getResponse().getStatus()).isEqualTo(200);
    }

    private UUID member() {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO users(id,status) VALUES (?,'active')", id);
        AccountFixtures.passGate(jdbc, id);
        return id;
    }

    private String bearer(UUID userId) {
        return "Bearer " + jwt.issueAccessToken(userId).value();
    }
}
