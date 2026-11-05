package com.acttub.actingapi.platform.security;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

/**
 * 플랫폼별 최소 앱 판(강제 업데이트, SOMA-1049). iOS 1.1.1은 「다른 배우 영상」 썸네일에서 꺼져 1.1.2로 올려 보낸다.
 * 앱 판 헤더에는 플랫폼이 없어 User-Agent 로 가른다 — 운영 refresh_tokens.device_info 에서 iOS 는
 * {@code Acttub/61 CFNetwork/… Darwin/…}, 안드로이드는 {@code okhttp/4.12.0} 임을 확인했다(11/5).
 */
class ClientMinimumVersionTest {

    private static final String IOS_UA = "Acttub/61 CFNetwork/3860.700.2 Darwin/25.6.0";
    private static final String ANDROID_UA = "okhttp/4.12.0";
    private static final String WEB_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";

    private static MockHttpServletResponse call(ClientVersionFilter filter, String client, String userAgent) throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/v2/me");
        request.setRequestURI("/v2/me");
        request.addHeader(ClientVersionFilter.HEADER, client);
        if (userAgent != null) request.addHeader("User-Agent", userAgent);
        MockHttpServletResponse response = new MockHttpServletResponse();
        filter.doFilter(request, response, new MockFilterChain());
        return response;
    }

    @Test
    void iOS_최소_판보다_낮으면_426과_업데이트_안내를_돌려준다() throws Exception {
        MockHttpServletResponse response = call(new ClientVersionFilter("1.1.2", ""), "app/1.1.1", IOS_UA);

        assertThat(response.getStatus()).isEqualTo(426);
        assertThat(response.getContentAsString()).contains(ClientVersionFilter.UPGRADE_NOTICE);
    }

    @Test
    void iOS_최소_판_이상이면_통과한다_판은_숫자로_비교한다() throws Exception {
        ClientVersionFilter filter = new ClientVersionFilter("1.1.2", "");
        assertThat(call(filter, "app/1.1.2", IOS_UA).getStatus()).isEqualTo(200);
        assertThat(call(filter, "app/1.1.10", IOS_UA).getStatus()).isEqualTo(200);
        assertThat(call(filter, "app/1.2", IOS_UA).getStatus()).isEqualTo(200);
    }

    @Test
    void iOS_최소_판은_안드로이드를_막지_않는다() throws Exception {
        assertThat(call(new ClientVersionFilter("1.1.2", ""), "app/1.1.1", ANDROID_UA).getStatus()).isEqualTo(200);
    }

    @Test
    void 안드로이드_최소_판은_안드로이드만_막는다() throws Exception {
        ClientVersionFilter filter = new ClientVersionFilter("", "1.1.2");
        assertThat(call(filter, "app/1.1.1", ANDROID_UA).getStatus()).isEqualTo(426);
        assertThat(call(filter, "app/1.1.1", IOS_UA).getStatus()).isEqualTo(200);
    }

    @Test
    void 플랫폼을_모르거나_판을_못_읽으면_막지_않는다() throws Exception {
        ClientVersionFilter filter = new ClientVersionFilter("9.9.9", "9.9.9");
        assertThat(call(filter, "app/1.1.1", WEB_UA).getStatus()).isEqualTo(200);
        assertThat(call(filter, "app/1.1.1", null).getStatus()).isEqualTo(200);
        assertThat(call(filter, "web/2026.11.05", IOS_UA).getStatus()).isEqualTo(200);
        assertThat(call(filter, "app/beta", IOS_UA).getStatus()).isEqualTo(200);
    }

    @Test
    void 최소_판이_비어_있으면_지금처럼_아무도_막지_않는다() throws Exception {
        ClientVersionFilter filter = new ClientVersionFilter();
        assertThat(call(filter, "app/0.1.0", IOS_UA).getStatus()).isEqualTo(200);
        assertThat(call(filter, "app/0.1.0", ANDROID_UA).getStatus()).isEqualTo(200);
        assertThat(call(new ClientVersionFilter(" ", "not-a-version"), "app/0.1.0", ANDROID_UA).getStatus()).isEqualTo(200);
    }
}
