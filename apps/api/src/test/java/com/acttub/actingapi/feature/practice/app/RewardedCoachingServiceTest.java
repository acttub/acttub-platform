package com.acttub.actingapi.feature.practice.app;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.time.Instant;
import java.util.UUID;

import com.acttub.actingapi.feature.practice.app.CoachingRewardRepository.Grant;
import com.acttub.actingapi.feature.practice.app.CoachingRewardRepository.NewReward;
import com.acttub.actingapi.feature.practice.app.RewardedCoachingService.Outcome;
import com.acttub.actingapi.support.MutableClock;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** 「광고 보고 1회 더」(SOMA-1067)의 규칙 — 스위치·대상·한도 소진·하루 상한. 저장소는 가짜다. */
class RewardedCoachingServiceTest {
    /** 2026-11-24 10:00 KST. 오늘 0시(KST)는 2026-11-23T15:00Z 다. */
    final MutableClock clock = new MutableClock(Instant.parse("2026-11-24T01:00:00Z"));
    final Instant midnight = Instant.parse("2026-11-23T15:00:00Z");
    final CoachingRewardRepository rewards = mock(CoachingRewardRepository.class);
    final UUID user = UUID.randomUUID();
    final UUID request = UUID.randomUUID();

    RewardedCoachingService service(boolean enabled, CoachingPlan plan) {
        return new RewardedCoachingService(enabled, 1, plan, rewards, clock);
    }

    @Test
    @DisplayName("스위치가 꺼져 있으면 아무것도 읽지 않고 0·false·ignored — 기존 한도가 그대로다")
    void offChangesNothing() {
        RewardedCoachingService off = service(false, id -> true);
        assertThat(off.enabled()).isFalse();
        assertThat(off.extraSessions(user, midnight)).isZero();
        assertThat(off.available(user, false)).isFalse();
        assertThat(off.granted(user, request)).isFalse();
        assertThat(off.grant(user.toString(), request.toString(), "tx")).isEqualTo(Outcome.IGNORED);
        assertThat(new RewardedCoachingService(true, 0, id -> true, rewards, clock).enabled()).as("상한 0 도 꺼짐").isFalse();
        verifyNoInteractions(rewards);
    }

    @Test
    @DisplayName("버튼은 한도가 걸린 회원이 오늘 회차를(받은 보상분까지) 다 썼고 상한이 남았을 때만")
    void availableOnlyWhenExhaustedAndUnderTheCap() {
        RewardedCoachingService on = service(true, id -> true);
        when(rewards.grantedSince(user, midnight)).thenReturn(0);
        when(rewards.sessionsSince(user, midnight)).thenReturn(2);
        assertThat(on.available(user, false)).as("아직 남았다").isFalse();
        when(rewards.sessionsSince(user, midnight)).thenReturn(3);
        assertThat(on.available(user, false)).isTrue();
        assertThat(on.available(user, true)).as("게스트").isFalse();
        when(rewards.grantedSince(user, midnight)).thenReturn(1);
        when(rewards.sessionsSince(user, midnight)).thenReturn(4);
        assertThat(on.available(user, false)).as("오늘 상한을 채웠다").isFalse();

        assertThat(service(true, CoachingPlan.UNLIMITED).available(user, false)).as("Pro·한도 꺼짐·유예").isFalse();
    }

    @Test
    @DisplayName("지급은 한도 대상에게만, 오늘 0시(KST)와 상한으로 저장소에 맡긴다. 값이 이상하면 ignored")
    void grantsOnlyToFreeLimitedMembers() {
        RewardedCoachingService on = service(true, id -> true);
        when(rewards.grant(any(), eq(midnight), eq(1), eq(clock.instant()))).thenReturn(Grant.GRANTED);
        assertThat(on.grant(user.toString(), request.toString(), "a1B2c3")).isEqualTo(Outcome.GRANTED);
        verify(rewards).grant(new NewReward("a1B2c3", user, request), midnight, 1, clock.instant());

        when(rewards.grant(any(), any(), anyInt(), any())).thenReturn(Grant.DUPLICATE);
        assertThat(on.grant(user.toString(), request.toString(), "a1B2c3")).isEqualTo(Outcome.DUPLICATE);
        when(rewards.grant(any(), any(), anyInt(), any())).thenReturn(Grant.CAPPED);
        assertThat(on.grant(user.toString(), request.toString(), "x")).isEqualTo(Outcome.CAPPED);
        when(rewards.grant(any(), any(), anyInt(), any())).thenReturn(Grant.NO_USER);
        assertThat(on.grant(user.toString(), request.toString(), "y")).isEqualTo(Outcome.IGNORED);

        assertThat(on.grant("actor@example.com", request.toString(), "z")).isEqualTo(Outcome.IGNORED);
        assertThat(on.grant(user.toString(), null, "z")).isEqualTo(Outcome.IGNORED);
        assertThat(on.grant(user.toString(), request.toString(), null)).isEqualTo(Outcome.IGNORED);
        assertThat(on.grant(user.toString(), request.toString(), "bad id;drop")).isEqualTo(Outcome.IGNORED);
        assertThat(on.grant(user.toString(), request.toString(), "x".repeat(129))).isEqualTo(Outcome.IGNORED);

        CoachingRewardRepository untouched = mock(CoachingRewardRepository.class);
        RewardedCoachingService proOnly = new RewardedCoachingService(true, 1, CoachingPlan.UNLIMITED, untouched, clock);
        assertThat(proOnly.grant(user.toString(), request.toString(), "p")).as("Pro 는 지급하지 않는다").isEqualTo(Outcome.IGNORED);
        verify(untouched, never()).grant(any(), any(), anyInt(), any());
    }

    @Test
    @DisplayName("켜져 있으면 오늘 받은 보상 수만큼 한도에 더하고, 요청 id 로 지급을 확인한다")
    void bonusAndConfirmation() {
        RewardedCoachingService on = service(true, id -> true);
        when(rewards.grantedSince(user, midnight)).thenReturn(1);
        assertThat(on.extraSessions(user, midnight)).isEqualTo(1);
        when(rewards.granted(user, request)).thenReturn(true);
        assertThat(on.granted(user, request)).isTrue();
        assertThat(on.granted(user, null)).isFalse();
    }
}
