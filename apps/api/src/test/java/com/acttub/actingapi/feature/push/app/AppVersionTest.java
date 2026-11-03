package com.acttub.actingapi.feature.push.app;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class AppVersionTest {
    @Test void comparesNumericDotSeparatedParts() {
        assertThat(AppVersion.atLeast("0.1.10", "0.1.9")).isTrue();
        assertThat(AppVersion.atLeast("0.1.2", "0.1.2")).isTrue();
        assertThat(AppVersion.atLeast("0.1", "0.1.1")).isFalse();
        assertThat(AppVersion.atLeast(null, "0.1.2")).isFalse();
        assertThat(AppVersion.atLeast("0.1.beta", "0.1.2")).isFalse();
    }

    @Test void aVersionLongerThanTheLimitIsInvalidWithoutReachingTheRegex() {
        // 수정 전에는 StackOverflowError 가 났다
        assertThat(AppVersion.valid("1.".repeat(50_000) + "1")).isFalse();
        assertThat(AppVersion.atLeast("1.".repeat(50_000) + "1", "0.1.2")).isFalse();
        assertThat(AppVersion.valid("1".repeat(64))).isTrue();
        assertThat(AppVersion.valid("1".repeat(65))).isFalse();
    }
}
