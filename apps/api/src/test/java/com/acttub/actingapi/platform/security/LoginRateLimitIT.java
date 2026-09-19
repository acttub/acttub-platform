package com.acttub.actingapi.platform.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import com.acttub.actingapi.support.PostgresContainerSupport;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;

/**
 * account.login: 한 IP 에서 1분에 61번째 로그인은 429 다. 로그인은 주체가 없는 요청이라 IP 로만 센다.
 *
 * <p>{@code RateLimitContractIT} 와 컨텍스트를 나눈 이유는 그쪽 주석에 있다 — 로그인과 갱신이 같은
 * IP 키를 쓰고 카운터를 지울 수단이 없다. 이 클래스는 그 키를 쓰는 케이스가 하나뿐이다.
 */
@SpringBootTest(properties = {"JWT_SECRET=test-secret", "DEVELOPMENT_AUTH_PROVIDER=1"})
@AutoConfigureMockMvc
class LoginRateLimitIT {

    /** 분 경계를 한 번 넘더라도 반드시 한도를 넘는 횟수({@code RateLimitContractIT} 와 같은 이유). */
    private static final int ENOUGH_TO_CROSS_ANY_WINDOW = 121;

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        String name = PostgresContainerSupport.createDatabaseName("login_rate_limit");
        registry.add("spring.datasource.url", () -> PostgresContainerSupport.jdbcUrlFor(name));
        registry.add("spring.datasource.username", PostgresContainerSupport.POSTGRES::getUsername);
        registry.add("spring.datasource.password", PostgresContainerSupport.POSTGRES::getPassword);
    }

    @Autowired
    MockMvc mvc;

    @Autowired
    ObjectMapper mapper;

    @Test
    void theSixtyFirstLoginFromOneAddressIsRejectedWhoeverLogsIn() throws Exception {
        for (int attempt = 1; attempt <= ENOUGH_TO_CROSS_ANY_WINDOW; attempt++) {
            // 시도마다 다른 사람이다 — 회원별로 셌다면 한도에 닿지 않는다.
            var response = mvc.perform(post("/v2/auth/login")
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"provider\":\"development\",\"id_token\":\"dev-" + attempt + "\"}"))
                    .andReturn().getResponse();
            if (response.getStatus() == 429) {
                assertThat(mapper.readTree(response.getContentAsString()))
                        .isEqualTo(mapper.readTree("{\"detail\":\"rate limit exceeded\"}"));
                assertThat(attempt).as("한도 60 을 넘기기 전에 거절됐다").isGreaterThan(60);
                return;
            }
            assertThat(response.getStatus()).isEqualTo(200);
        }
        throw new AssertionError(ENOUGH_TO_CROSS_ANY_WINDOW + " 회를 보내도 429 가 나오지 않았다");
    }
}
