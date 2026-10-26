package com.acttub.actingapi.feature.coach.adapter;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

/** SOMA-855 비교는 설정이 없으면 dev 에서만 켜진다. 운영은 운영 env 로 켜기 전까지 0 이다. */
class DirectVideoConfigurationAlreadyTest {
    @Test void withoutASettingOnlyDevRunsTheExperiment() {
        assertThat(DirectVideoConfiguration.alreadyShare(-1, "https://dev.acttub.com")).isEqualTo(50);
        assertThat(DirectVideoConfiguration.alreadyShare(-1, "https://acttub.com")).isZero();
        assertThat(DirectVideoConfiguration.alreadyShare(-1, "")).isZero();
        assertThat(DirectVideoConfiguration.alreadyShare(30, "https://acttub.com")).isEqualTo(30);
        assertThat(DirectVideoConfiguration.alreadyShare(0, "https://dev.acttub.com")).isZero();
    }
}
