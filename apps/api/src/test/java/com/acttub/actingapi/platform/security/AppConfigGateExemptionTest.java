package com.acttub.actingapi.platform.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;

/**
 * 앱 운영 값(GET /v2/app/config, SOMA-939)은 앱이 켤 때 로그인 없이 부른다. 게이트 안에 두었더니 늘 401 이라
 * 서버에서 바꾼 값(리딩 끊어 읽기 줄 수 등)이 앱에 한 번도 내려가지 않았다(11/3 앱 시작 측정에서 발견).
 */
class AppConfigGateExemptionTest {
    @Test
    void appConfigIsReadableWithoutLogin() {
        assertThat(ConsentGateInterceptor.gateFor("GET", "/v2/app/config")).isEqualTo(ConsentGateInterceptor.Gate.NONE);
        // 공지 포스터는 그대로 회원 게이트 안이다.
        assertThat(ConsentGateInterceptor.gateFor("GET", "/v2/app/posters")).isEqualTo(ConsentGateInterceptor.Gate.FULL);

        // 만료된 토큰이 붙어 와도 401 로 막지 않는다(오디션·동의 문서 같은 공개 경로와 같다).
        AccessTokenFilter access = new AccessTokenFilter(mock(CurrentUserService.class));
        MockHttpServletRequest config = new MockHttpServletRequest("GET", "/v2/app/config");
        config.addHeader("Authorization", "Bearer expired");
        assertThat(access.shouldNotFilter(config)).isTrue();
        MockHttpServletRequest posters = new MockHttpServletRequest("GET", "/v2/app/posters");
        posters.addHeader("Authorization", "Bearer app-token");
        assertThat(access.shouldNotFilter(posters)).isFalse();
    }
}
