package com.acttub.actingapi.feature.appversion.domain;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class AppVersionTest {

    @Test
    void 세_자리_판을_읽고_두_자리는_잔판_0으로_읽는다() {
        assertThat(AppVersion.parse("1.2.3")).contains(new AppVersion(1, 2, 3));
        assertThat(AppVersion.parse(" 1.10 ")).contains(new AppVersion(1, 10, 0));
    }

    @Test
    void 판이_아닌_글은_읽지_않는다() {
        assertThat(AppVersion.parse(null)).isEmpty();
        assertThat(AppVersion.parse("")).isEmpty();
        assertThat(AppVersion.parse("1")).isEmpty();
        assertThat(AppVersion.parse("1.2.3.4")).isEmpty();
        assertThat(AppVersion.parse("v1.2.3")).isEmpty();
        assertThat(AppVersion.parse("1.2.3-beta")).isEmpty();
        assertThat(AppVersion.parse("1234567.0.0")).isEmpty();
    }

    @Test
    void Play_출시_이름_안에서_판을_찾는다() {
        assertThat(AppVersion.find("1.2.0")).contains(new AppVersion(1, 2, 0));
        assertThat(AppVersion.find("28 (1.1.1)")).contains(new AppVersion(1, 1, 1));
        assertThat(AppVersion.find("1.1.3 (31) 크래시 수정")).contains(new AppVersion(1, 1, 3));
        assertThat(AppVersion.find("핫픽스 2")).isEmpty();
        assertThat(AppVersion.find("1.2.3.4")).isEmpty();
        assertThat(AppVersion.find(null)).isEmpty();
    }

    @Test
    void 숫자로_비교하고_마이너_바닥은_잔판을_0으로_만든다() {
        assertThat(new AppVersion(1, 10, 0)).isGreaterThan(new AppVersion(1, 9, 9));
        assertThat(new AppVersion(2, 0, 0)).isGreaterThan(new AppVersion(1, 99, 99));
        assertThat(new AppVersion(1, 2, 7).minorFloor()).isEqualTo(new AppVersion(1, 2, 0));
        assertThat(new AppVersion(1, 2, 7)).hasToString("1.2.7");
    }
}
