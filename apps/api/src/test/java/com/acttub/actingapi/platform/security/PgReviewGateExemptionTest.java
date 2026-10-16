package com.acttub.actingapi.platform.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;

/**
 * PG 심사 전용 경로(/v2/pg-review/**)는 앱 인증·동의·클라이언트 판 게이트 밖이다(토스 콜백은 헤더를 실을 수 없다).
 * 반대로 그 밖의 /v2 경로는 그대로 게이트 안에 있어야 한다.
 */
class PgReviewGateExemptionTest {
    @Test
    void consentGateLeavesReviewPathsAloneButNotLookalikes() {
        assertThat(ConsentGateInterceptor.gateFor("GET", "/v2/pg-review/success")).isEqualTo(ConsentGateInterceptor.Gate.NONE);
        assertThat(ConsentGateInterceptor.gateFor("POST", "/v2/pg-review/login")).isEqualTo(ConsentGateInterceptor.Gate.NONE);
        assertThat(ConsentGateInterceptor.gateFor("GET", "/v2/pg-reviews")).isEqualTo(ConsentGateInterceptor.Gate.FULL);
        assertThat(ConsentGateInterceptor.gateFor("GET", "/v2/pg-review-evil/x")).isEqualTo(ConsentGateInterceptor.Gate.FULL);
        assertThat(ConsentGateInterceptor.gateFor("POST", "/v2/billing/anything")).isEqualTo(ConsentGateInterceptor.Gate.FULL);
    }

    @Test
    void clientVersionFilterAndAccessTokenFilterSkipOnlyReviewPaths() {
        ClientVersionFilter version = new ClientVersionFilter();
        assertThat(version.shouldNotFilter(request("/v2/pg-review/success"))).isTrue();
        assertThat(version.shouldNotFilter(request("/v2/pg-review/config"))).isTrue();
        assertThat(version.shouldNotFilter(request("/v2/pg-reviewx"))).isFalse();
        assertThat(version.shouldNotFilter(request("/v2/me"))).isFalse();

        AccessTokenFilter access = new AccessTokenFilter(mock(CurrentUserService.class));
        MockHttpServletRequest withToken = request("/v2/pg-review/result");
        withToken.addHeader("Authorization", "Bearer app-token");
        assertThat(access.shouldNotFilter(withToken)).isTrue();
        MockHttpServletRequest other = request("/v2/me");
        other.addHeader("Authorization", "Bearer app-token");
        assertThat(access.shouldNotFilter(other)).isFalse();
    }

    private static MockHttpServletRequest request(String path) {
        return new MockHttpServletRequest("GET", path);
    }
}
