package com.acttub.actingapi.feature.coach.adapter;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

/** 첫 코칭 첫 말 비교는 설정이 없으면 dev 에서만 켜진다. 운영은 운영 env 로 켜기 전까지 꺼져 있다. */
class DirectVideoConfigurationOpeningTest {
    @Test void withoutASettingDevAndProductionRunTheExperiment() {
        assertThat(DirectVideoConfiguration.openingAb("", "https://dev.acttub.com")).isTrue();
        assertThat(DirectVideoConfiguration.openingAb("", "https://acttub.com")).isTrue();
        assertThat(DirectVideoConfiguration.openingAb("", "")).isFalse();
        assertThat(DirectVideoConfiguration.openingAb(null, "https://acttub.com")).isTrue();
        assertThat(DirectVideoConfiguration.openingAb("true", "https://acttub.com")).isTrue();
        assertThat(DirectVideoConfiguration.openingAb("false", "https://dev.acttub.com")).isFalse();
    }
}
