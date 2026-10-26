package com.acttub.actingapi.feature.practice.app;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Instant;
import java.time.ZoneOffset;
import java.util.UUID;

import com.acttub.actingapi.feature.practice.app.PracticeRepository.Quota;
import com.acttub.actingapi.feature.practice.app.PracticeRepository.StartOutcome;
import com.acttub.actingapi.feature.practice.app.PracticeRepository.Started;
import com.acttub.actingapi.platform.web.ApiException;
import com.acttub.actingapi.support.MutableClock;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

/** 무료 코칭 하루 1회(SOMA-818) — 플래그가 켜지고 Pro 가 아닐 때만 회차 한도를 건다. */
class FreeCoachingLimitTest {
    final PracticeRepository practices = mock(PracticeRepository.class);
    final MutableClock clock = new MutableClock(Instant.parse("2026-10-23T05:00:00Z"));
    final UUID user = UUID.randomUUID();

    PracticeService service(CoachingPlan plan) {
        return new PracticeService(practices, mock(LegacyPracticeReader.class), mock(PracticePosters.class), false, true,
                plan, clock);
    }

    PracticeService.Draft talk() {
        return new PracticeService.Draft(UUID.randomUUID(), null, null, null, null, null, null, null, null, "concern");
    }

    @Test
    @DisplayName("한도가 걸리면 오늘 0시(KST) 이후 회차 1개 한도를 넘겨 429 free_daily_coaching_limit")
    void limited() {
        when(practices.startWithoutVideo(eq(user), any(), any(), any())).thenReturn(new Started(StartOutcome.QUOTA, null));
        assertThatThrownBy(() -> service(id -> true).start(user, false, null, talk()))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.getMessage()).contains("free_daily_coaching_limit"));
        ArgumentCaptor<Quota> quota = ArgumentCaptor.forClass(Quota.class);
        verify(practices).startWithoutVideo(eq(user), any(), quota.capture(), any());
        assertThat(quota.getValue().kind()).isEqualTo(Quota.Kind.SESSIONS);
        assertThat(quota.getValue().limit()).isEqualTo(1);
        assertThat(quota.getValue().since().atOffset(ZoneOffset.ofHours(9)).getHour()).isZero();
    }

    @Test
    @DisplayName("플래그가 꺼져 있거나 Pro 면 한도를 넘기지 않는다")
    void unlimited() {
        when(practices.startWithoutVideo(eq(user), any(), any(), any())).thenReturn(new Started(StartOutcome.QUOTA, null));
        assertThatThrownBy(() -> service(CoachingPlan.UNLIMITED).start(user, false, null, talk()))
                .hasMessageContaining("guest_daily_analysis_limit");
        verify(practices).startWithoutVideo(eq(user), any(), eq(null), any());
    }
}
