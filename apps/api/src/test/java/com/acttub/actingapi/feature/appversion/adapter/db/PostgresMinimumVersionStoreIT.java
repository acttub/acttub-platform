package com.acttub.actingapi.feature.appversion.adapter.db;

import static org.assertj.core.api.Assertions.assertThat;

import com.acttub.actingapi.feature.appversion.app.MinimumVersionService;
import com.acttub.actingapi.feature.appversion.app.MinimumVersionStore;
import com.acttub.actingapi.feature.appversion.domain.AppVersion;
import com.acttub.actingapi.feature.appversion.domain.MinimumVersionState;
import com.acttub.actingapi.feature.appversion.domain.StorePlatform;
import com.acttub.actingapi.platform.security.ClientVersionFilter;
import java.time.Instant;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

/**
 * 자동 최소 판 기록을 <b>실제 Postgres 위에서</b> 본다(SOMA-1150) — 스토어 판이 바뀔 때만 처음 본 시각을 새로 적고, 올리기는
 * 지금 최소 판이 기대한 값일 때만 한 번 일어난다. 스위치를 켠 앱에서 강제 업데이트 필터가 올린 값을 쓰는지도 본다.
 * 스토어 조회는 하루 뒤로 미뤄 이 테스트가 바깥을 부르지 않는다.
 */
@SpringBootTest(properties = {
        "JWT_SECRET=test-secret",
        "MIN_VERSION_AUTO_RAISE=true",
        "MIN_VERSION_CHECK_DELAY_MS=86400000",
        "MIN_VERSION_REFRESH_MS=86400000"})
class PostgresMinimumVersionStoreIT {

    private static final Instant T0 = Instant.parse("2026-12-01T00:00:00Z");
    private static final String IOS_UA = "Acttub/61 CFNetwork/3860.700.2 Darwin/25.6.0";

    @Autowired
    JdbcTemplate jdbc;

    @Autowired
    MinimumVersionStore store;

    @Autowired
    MinimumVersionService service;

    @Autowired
    ClientVersionFilter filter;

    @BeforeEach
    void clear() {
        jdbc.execute("DELETE FROM app_min_versions");
    }

    private static AppVersion v(String text) {
        return AppVersion.parse(text).orElseThrow();
    }

    @Test
    void 같은_스토어_판을_다시_보면_처음_본_시각을_지키고_바뀌면_새로_적는다() {
        store.observe(StorePlatform.IOS, v("1.2.0"), T0);
        store.observe(StorePlatform.IOS, v("1.2.0"), T0.plusSeconds(600));
        assertThat(store.load().get(StorePlatform.IOS))
                .isEqualTo(new MinimumVersionState(StorePlatform.IOS, null, v("1.2.0"), T0));

        store.observe(StorePlatform.IOS, v("1.2.1"), T0.plusSeconds(1200));
        assertThat(store.load().get(StorePlatform.IOS).liveSince()).isEqualTo(T0.plusSeconds(1200));
        assertThat(store.load()).doesNotContainKey(StorePlatform.ANDROID);
    }

    @Test
    void 올리기는_지금_최소_판이_기대한_값일_때만_한_번_일어난다() {
        store.observe(StorePlatform.ANDROID, v("1.2.0"), T0);

        assertThat(store.raise(StorePlatform.ANDROID, null, v("1.2.0"), T0)).isTrue();
        assertThat(store.raise(StorePlatform.ANDROID, null, v("1.2.0"), T0)).isFalse();
        assertThat(store.raise(StorePlatform.ANDROID, v("1.1.0"), v("1.3.0"), T0)).isFalse();
        assertThat(store.raise(StorePlatform.ANDROID, v("1.2.0"), v("1.3.0"), T0)).isTrue();
        assertThat(store.load().get(StorePlatform.ANDROID).minimum()).isEqualTo(v("1.3.0"));
        assertThat(store.raise(StorePlatform.IOS, null, v("1.3.0"), T0)).as("줄이 없으면 올리지 않는다").isFalse();
    }

    @Test
    void 스위치를_켠_앱의_강제_업데이트_필터는_올린_최소_판으로_막는다() throws Exception {
        store.observe(StorePlatform.IOS, v("1.2.0"), T0);
        store.raise(StorePlatform.IOS, null, v("1.2.0"), T0);
        service.refresh();

        assertThat(service.ios()).isEqualTo("1.2.0");
        assertThat(call("app/1.1.9")).isEqualTo(426);
        assertThat(call("app/1.2.0")).isEqualTo(200);
    }

    private int call(String client) throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/v2/me");
        request.setRequestURI("/v2/me");
        request.addHeader(ClientVersionFilter.HEADER, client);
        request.addHeader("User-Agent", IOS_UA);
        MockHttpServletResponse response = new MockHttpServletResponse();
        filter.doFilter(request, response, new MockFilterChain());
        return response.getStatus();
    }
}
