package com.acttub.actingapi.feature.profile.app;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.support.RecordingFailureReporter;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

class AccountHousekeepingTest {
    private final ProfileRepository profiles = mock(ProfileRepository.class);
    private final ProfileService accounts = mock(ProfileService.class);
    private final AccountCleanup cleanup = mock(AccountCleanup.class);
    private final RecordingFailureReporter failures = new RecordingFailureReporter();
    private final AccountHousekeeping housekeeping = new AccountHousekeeping(
            profiles, accounts, cleanup, failures, Clock.fixed(Instant.parse("2026-10-02T19:30:00Z"), ZoneOffset.UTC));

    @Test
    @DisplayName("account.withdraw: 매일 도는 일은 한 가지가 실패해도 나머지가 돌고, 실패는 보고된다")
    void oneFailingStepDoesNotStopTheRest() {
        UUID broken = UUID.randomUUID();
        UUID fine = UUID.randomUUID();
        when(profiles.deleteStaleRefreshTokens(any())).thenThrow(new IllegalStateException("db is busy"));
        when(profiles.idleGuests(any())).thenReturn(List.of(broken, fine));
        doThrow(new IllegalStateException("storage is down")).when(accounts).withdraw(broken);
        when(profiles.purgeRetained(any(), any())).thenReturn(List.of());

        housekeeping.runDaily();

        verify(accounts).withdraw(fine);
        verify(cleanup).runDue();
        verify(profiles).deleteStaleTransferCodes(any());
        assertThat(failures.contexts())
                .containsExactly("AccountHousekeeping.refreshTokens", "AccountHousekeeping.idleGuest");
    }

    @Test
    @DisplayName("account.withdraw: 3년은 달력의 3년이다 — 한국 시간으로 3년 전 같은 시각보다 앞선 탈퇴만 고른다")
    void threeYearsAreCalendarYears() {
        when(profiles.idleGuests(any())).thenReturn(List.of());
        when(profiles.purgeRetained(any(), any())).thenReturn(List.of());

        housekeeping.runDaily();

        verify(profiles).purgeRetained(Instant.parse("2023-10-02T19:30:00Z"), Instant.parse("2026-10-02T19:30:00Z"));
    }
}
