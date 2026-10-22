package com.acttub.actingapi.platform.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;

/**
 * 앱 Pro 카드 등록 창(/v2/billing/web/**, SOMA-818)만 게이트 밖이다 — 브라우저가 열어 앱 헤더가 없다. 나머지 결제 API
 * (/v2/billing/me·checkout·subscription)는 그대로 앱 토큰·동의·클라이언트 판 게이트 안이다.
 */
class BillingGateExemptionTest {
    @Test
    void onlyTheBrowserPagesAreOutsideTheGate() {
        assertThat(ConsentGateInterceptor.gateFor("GET", "/v2/billing/web/checkout/abc")).isEqualTo(ConsentGateInterceptor.Gate.NONE);
        assertThat(ConsentGateInterceptor.gateFor("GET", "/v2/billing/web/checkout/abc/success")).isEqualTo(ConsentGateInterceptor.Gate.NONE);
        assertThat(ConsentGateInterceptor.gateFor("POST", "/v2/billing/web/checkout/abc")).isEqualTo(ConsentGateInterceptor.Gate.FULL);
        assertThat(ConsentGateInterceptor.gateFor("GET", "/v2/billing/me")).isEqualTo(ConsentGateInterceptor.Gate.FULL);
        assertThat(ConsentGateInterceptor.gateFor("POST", "/v2/billing/checkout")).isEqualTo(ConsentGateInterceptor.Gate.FULL);

        ClientVersionFilter version = new ClientVersionFilter();
        assertThat(version.shouldNotFilter(new MockHttpServletRequest("GET", "/v2/billing/web/checkout/abc"))).isTrue();
        assertThat(version.shouldNotFilter(new MockHttpServletRequest("GET", "/v2/billing/me"))).isFalse();

        AccessTokenFilter access = new AccessTokenFilter(mock(CurrentUserService.class));
        MockHttpServletRequest page = new MockHttpServletRequest("GET", "/v2/billing/web/checkout/abc/success");
        page.addHeader("Authorization", "Bearer app-token");
        assertThat(access.shouldNotFilter(page)).isTrue();
        MockHttpServletRequest me = new MockHttpServletRequest("GET", "/v2/billing/me");
        me.addHeader("Authorization", "Bearer app-token");
        assertThat(access.shouldNotFilter(me)).isFalse();
    }
}
