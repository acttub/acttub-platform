package com.acttub.actingapi.platform.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import tools.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

/**
 * account.login: 한 IP 에서 1분에 61번째 로그인은 429 다. 로그인은 주체가 없는 요청이라 IP 로만 센다.
 *
 * <p>카운터는 컨텍스트에 남고 지울 수단이 없다({@code FixedWindowRateLimiter}). 그래서 이 클래스만 쓰는 방문자 주소로
 * 보낸다 — 컨텍스트를 같이 쓰는 다른 클래스의 로그인·갱신(127.0.0.1)이 먼저 깎아 놓은 창에 걸리지 않는다.
 */
@SpringBootTest(properties = {"JWT_SECRET=test-secret", "DEVELOPMENT_AUTH_PROVIDER=1"})
@AutoConfigureMockMvc
class LoginRateLimitIT {

    /** 분 경계를 한 번 넘더라도 반드시 한도를 넘는 횟수({@code RateLimitContractIT} 와 같은 이유). */
    private static final int ENOUGH_TO_CROSS_ANY_WINDOW = 121;

    /** 이 클래스만 쓰는 방문자 주소. 다른 테스트 클래스와 겹치지 않는 대역이다. */
    private static final String ADDRESS = "10.70.0.1";

    @Autowired
    MockMvc mvc;

    @Autowired
    ObjectMapper mapper;

    @Test
    void theSixtyFirstLoginFromOneAddressIsRejectedWhoeverLogsIn() throws Exception {
        for (int attempt = 1; attempt <= ENOUGH_TO_CROSS_ANY_WINDOW; attempt++) {
            // 시도마다 다른 사람이다 — 회원별로 셌다면 한도에 닿지 않는다.
            var response = mvc.perform(post("/v2/auth/login")
                            .with(request -> {
                                request.setRemoteAddr(ADDRESS);
                                return request;
                            })
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
