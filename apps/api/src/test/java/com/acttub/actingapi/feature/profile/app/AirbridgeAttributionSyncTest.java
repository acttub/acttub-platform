package com.acttub.actingapi.feature.profile.app;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

import com.acttub.actingapi.feature.profile.app.AirbridgeLookupStore.Lookup;
import com.acttub.actingapi.feature.profile.domain.SignupAttribution;
import com.acttub.actingapi.integration.airbridge.AirbridgeAttribution;
import com.acttub.actingapi.integration.airbridge.AirbridgeAttributionClient;
import com.acttub.actingapi.integration.airbridge.AirbridgeUnavailable;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

class AirbridgeAttributionSyncTest {
    private static final Instant NOW = Instant.parse("2026-10-15T03:00:00Z");

    private final Map<UUID, Lookup> rows = new HashMap<>();
    private final Map<UUID, Instant> nextAt = new HashMap<>();
    private final Set<UUID> attributed = new java.util.HashSet<>();
    private final List<String> calls = new ArrayList<>();
    private AirbridgeAttributionClient airbridge;
    private ProfileRepository profiles;
    private AirbridgeAttributionSync sync;

    @BeforeEach
    void setUp() {
        airbridge = mock(AirbridgeAttributionClient.class);
        profiles = mock(ProfileRepository.class);
        when(profiles.recordSignupAttribution(any(), any())).thenReturn(true);
        AirbridgeLookupStore store = new AirbridgeLookupStore() {
            @Override
            public List<Lookup> due(Instant now, int limit) {
                return rows.values().stream().limit(limit).toList();
            }

            @Override
            public boolean hasAttribution(UUID userId) {
                return attributed.contains(userId);
            }

            @Override
            public void delete(UUID userId) {
                rows.remove(userId);
            }

            @Override
            public void retryAt(UUID userId, Instant next) {
                nextAt.put(userId, next);
            }
        };
        sync = new AirbridgeAttributionSync(store, airbridge, profiles, Clock.fixed(NOW, ZoneOffset.UTC));
    }

    private UUID row(Instant createdAt, int attempts) {
        UUID user = UUID.randomUUID();
        rows.put(user, new Lookup(user, "android", "11111111-2222-3333-4444-555555555555", createdAt, attempts));
        return user;
    }

    @Test
    @DisplayName("귀속이 있으면 airbridge 출처로 적고 기기 ID 줄을 지운다")
    void recordsAndDeletes() {
        UUID user = row(NOW.minusSeconds(60), 0);
        when(airbridge.lookup(any())).thenReturn(Optional.of(new AirbridgeAttribution(
                "  facebook.business ", "캠페인", null, "소재", "c", "t", "s")));

        AirbridgeAttributionSync.Result result = sync.runOnce();

        ArgumentCaptor<SignupAttribution> saved = ArgumentCaptor.forClass(SignupAttribution.class);
        verify(profiles).recordSignupAttribution(eq(user), saved.capture());
        assertThat(saved.getValue()).isEqualTo(new SignupAttribution(
                "airbridge", "android", "facebook.business", null, "캠페인", null, "소재", "c", "t", "s"));
        assertThat(rows).isEmpty();
        assertThat(result).isEqualTo(new AirbridgeAttributionSync.Result(1, 0, 0));
    }

    @Test
    @DisplayName("긴 값은 코드 포인트 200자로 자른다")
    void truncatesByCodePoints() {
        row(NOW, 0);
        String emoji = "\uD83D\uDE00".repeat(250);
        when(airbridge.lookup(any())).thenReturn(Optional.of(
                new AirbridgeAttribution("x", emoji, null, null, null, null, null)));

        sync.runOnce();

        ArgumentCaptor<SignupAttribution> saved = ArgumentCaptor.forClass(SignupAttribution.class);
        verify(profiles).recordSignupAttribution(any(), saved.capture());
        assertThat(saved.getValue().campaign().codePointCount(0, saved.getValue().campaign().length()))
                .isEqualTo(SignupAttribution.MAX_LENGTH);
    }

    @Test
    @DisplayName("이미 유입 기록이 있으면 Airbridge 를 부르지 않고 줄만 지운다")
    void existingAttributionDropsTheRow() {
        UUID user = row(NOW, 0);
        attributed.add(user);

        AirbridgeAttributionSync.Result result = sync.runOnce();

        verify(airbridge, never()).lookup(any());
        assertThat(rows).isEmpty();
        assertThat(result).isEqualTo(new AirbridgeAttributionSync.Result(0, 0, 1));
    }

    @Test
    @DisplayName("결과가 없거나 오류면 줄을 남기고 간격을 늘려 다시 본다")
    void emptyOrErrorBacksOff() {
        UUID first = row(NOW.minusSeconds(60), 0);
        UUID later = row(NOW.minusSeconds(60), 3);
        when(airbridge.lookup(any())).thenReturn(Optional.empty()).thenThrow(new AirbridgeUnavailable("down"));

        AirbridgeAttributionSync.Result result = sync.runOnce();

        assertThat(rows).containsKeys(first, later);
        assertThat(result.pending()).isEqualTo(2);
        assertThat(nextAt.values()).containsExactlyInAnyOrder(
                NOW.plus(Duration.ofMinutes(5)), NOW.plus(Duration.ofHours(3)));
        verify(profiles, never()).recordSignupAttribution(any(), any());
    }

    @Test
    @DisplayName("대기 간격은 5분 15분 1시간 3시간 6시간에서 멈춘다")
    void backoffSchedule() {
        assertThat(List.of(0, 1, 2, 3, 4, 5, 20).stream().map(AirbridgeAttributionSync::backoff).toList())
                .containsExactly(Duration.ofMinutes(5), Duration.ofMinutes(15), Duration.ofHours(1),
                        Duration.ofHours(3), Duration.ofHours(6), Duration.ofHours(6), Duration.ofHours(6));
    }

    @Test
    @DisplayName("24시간이 지난 줄은 조회 없이 지운다")
    void expiredRowsAreDropped() {
        row(NOW.minus(Duration.ofHours(24)).minusSeconds(1), 4);

        AirbridgeAttributionSync.Result result = sync.runOnce();

        verify(airbridge, never()).lookup(any());
        assertThat(rows).isEmpty();
        assertThat(result.dropped()).isEqualTo(1);
    }

    @Test
    @DisplayName("적을 수 없는 계정(탈퇴)이어도 기기 ID 줄은 지운다")
    void inactiveAccountStillDeletes() {
        row(NOW, 0);
        when(airbridge.lookup(any())).thenReturn(Optional.of(
                new AirbridgeAttribution("x", null, null, null, null, null, null)));
        when(profiles.recordSignupAttribution(any(), any())).thenReturn(false);

        AirbridgeAttributionSync.Result result = sync.runOnce();

        assertThat(rows).isEmpty();
        assertThat(result).isEqualTo(new AirbridgeAttributionSync.Result(0, 0, 1));
    }
}
