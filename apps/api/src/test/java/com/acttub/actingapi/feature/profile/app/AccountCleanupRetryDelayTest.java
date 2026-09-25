package com.acttub.actingapi.feature.profile.app;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Duration;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

class AccountCleanupRetryDelayTest {

    @Test
    @DisplayName("account.withdraw: 다시 시도하는 간격은 5분에서 시작해 두 배씩 늘고 12시간에서 멈춘다")
    void retryDelayDoublesFromFiveMinutesUpToTwelveHours() {
        assertThat(AccountCleanup.retryDelay(1)).isEqualTo(Duration.ofMinutes(5));
        assertThat(AccountCleanup.retryDelay(2)).isEqualTo(Duration.ofMinutes(10));
        assertThat(AccountCleanup.retryDelay(5)).isEqualTo(Duration.ofMinutes(80));
        assertThat(AccountCleanup.retryDelay(9)).isEqualTo(Duration.ofHours(12));
        assertThat(AccountCleanup.retryDelay(40)).isEqualTo(Duration.ofHours(12));
    }
}
