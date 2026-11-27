package com.acttub.actingapi.platform.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;

/**
 * 보상형 광고 확인 콜백(GET /v2/coaching-rewards/ssv, SOMA-1067)만 게이트 밖이다 — AdMob 서버가 불러 앱 토큰·앱 헤더가 없고 Google
 * 서명이 권한이다. 앱이 부르는 조회(/v2/coaching-rewards, /requests/{id})는 앱 토큰·동의·클라이언트 판 게이트 안이다.
 */
class CoachingRewardGateExemptionTest {
    @Test
    void onlyTheAdMobCallbackIsOutsideTheGate() {
        assertThat(ConsentGateInterceptor.gateFor("GET", "/v2/coaching-rewards/ssv")).isEqualTo(ConsentGateInterceptor.Gate.NONE);
        assertThat(ConsentGateInterceptor.gateFor("POST", "/v2/coaching-rewards/ssv")).isEqualTo(ConsentGateInterceptor.Gate.FULL);
        assertThat(ConsentGateInterceptor.gateFor("GET", "/v2/coaching-rewards")).isEqualTo(ConsentGateInterceptor.Gate.FULL);
        assertThat(ConsentGateInterceptor.gateFor("GET", "/v2/coaching-rewards/requests/abc")).isEqualTo(ConsentGateInterceptor.Gate.FULL);

        ClientVersionFilter version = new ClientVersionFilter();
        assertThat(version.shouldNotFilter(new MockHttpServletRequest("GET", "/v2/coaching-rewards/ssv"))).isTrue();
        assertThat(version.shouldNotFilter(new MockHttpServletRequest("GET", "/v2/coaching-rewards"))).isFalse();

        AccessTokenFilter access = new AccessTokenFilter(mock(CurrentUserService.class));
        MockHttpServletRequest callback = new MockHttpServletRequest("GET", "/v2/coaching-rewards/ssv");
        callback.addHeader("Authorization", "Bearer something");
        assertThat(access.shouldNotFilter(callback)).isTrue();
        MockHttpServletRequest status = new MockHttpServletRequest("GET", "/v2/coaching-rewards");
        status.addHeader("Authorization", "Bearer app-token");
        assertThat(access.shouldNotFilter(status)).isFalse();
    }
}
