package com.acttub.actingapi.feature.coach.adapter;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

/** 첫 코칭 첫 말 비교는 A 로 정리했다(2026-10-30). 설정이 없으면 어디서도 켜지지 않고, env 로만 다시 켤 수 있다. */
class DirectVideoConfigurationOpeningTest {
    @Test void withoutASettingTheExperimentIsOff() {
        assertThat(DirectVideoConfiguration.openingAb("", "https://dev.acttub.com")).isFalse();
        assertThat(DirectVideoConfiguration.openingAb("", "https://acttub.com")).isFalse();
        assertThat(DirectVideoConfiguration.openingAb("", "")).isFalse();
        assertThat(DirectVideoConfiguration.openingAb(null, "https://acttub.com")).isFalse();
        assertThat(DirectVideoConfiguration.openingAb("true", "https://acttub.com")).isTrue();
        assertThat(DirectVideoConfiguration.openingAb("false", "https://dev.acttub.com")).isFalse();
    }
}
