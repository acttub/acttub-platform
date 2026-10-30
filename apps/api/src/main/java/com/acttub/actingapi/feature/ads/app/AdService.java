package com.acttub.actingapi.feature.ads.app;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.UUID;

import com.acttub.actingapi.feature.ads.domain.Ad;
import com.acttub.actingapi.feature.ads.domain.AdPicker;
import com.acttub.actingapi.feature.ads.domain.AdSlot;

/**
 * 광고 칸 고르기와 노출·클릭 기록(SOMA-876).
 * {@code ADS_ENABLED=false} 면 모든 칸이 NONE 이다(앱 빌드 없이 끄는 길). 연습 중 칸은 {@code ADS_PRACTICE_SLOT_PERCENT}
 * (기본 50)% 의 무료 사용자에게만 켠다. 칸 하나만 끄려면 {@code ad_slot_switches} 에서 그 칸을 enabled=false 로 둔다.
 * 한 사람에게 너무 자주 나가지 않게, 최근 windowMinutes 분 동안 내보낸 광고(HOUSE·NETWORK·DIRECT)가 상한 이상이면 NONE 이다
 * ({@link AdFrequency}). 가입 24시간 이내는 더 낮은 첫날 상한을 쓴다. NONE 은 세지 않는다.
 */
public class AdService {
    static final Duration FIRST_DAY = Duration.ofHours(24);
    private static final ZoneId SEOUL = ZoneId.of("Asia/Seoul");

    public record Settings(boolean enabled, int practiceSlotPercent) {
    }

    public enum Event { IMPRESSION, CLICK }

    private final AdRepository repository;
    private final ProStatusReader proStatus;
    private final Settings settings;
    private final AdSlotSwitches switches;
    private final AdFrequency frequency;
    private final Clock clock;

    public AdService(AdRepository repository, ProStatusReader proStatus, Settings settings, Clock clock) {
        this(repository, proStatus, settings, AdSlotSwitches.ALWAYS_ON, clock);
    }

    public AdService(AdRepository repository, ProStatusReader proStatus, Settings settings, AdSlotSwitches switches,
            Clock clock) {
        this(repository, proStatus, settings, switches, AdFrequency.UNLIMITED, clock);
    }

    public AdService(AdRepository repository, ProStatusReader proStatus, Settings settings, AdSlotSwitches switches,
            AdFrequency frequency, Clock clock) {
        this.frequency = frequency;
        this.repository = repository;
        this.proStatus = proStatus;
        this.settings = settings;
        this.switches = switches;
        this.clock = clock;
    }

    public AdPicker.Pick pick(UUID userId, AdSlot slot) {
        if (!settings.enabled() || switches.off(slot.key())) {
            return new AdPicker.Pick(AdPicker.Kind.NONE, slot, null);
        }
        boolean practiced = repository.practiced(userId);
        if (!practiced) {
            return new AdPicker.Pick(AdPicker.Kind.NONE, slot, null);
        }
        Instant now = clock.instant();
        if (overFrequency(userId, now)) {
            return new AdPicker.Pick(AdPicker.Kind.NONE, slot, null);
        }
        AdPicker.Viewer viewer = new AdPicker.Viewer(
                userId, true, proStatus.pro(userId), AdPicker.practiceOn(userId, settings.practiceSlotPercent()));
        AdPicker.Pick pick = AdPicker.pick(slot, viewer, repository.activeFor(slot.key(), now), today(now));
        if (pick.kind() != AdPicker.Kind.NONE) {
            frequency.recordServe(userId, now);
        }
        return pick;
    }

    private boolean overFrequency(UUID userId, Instant now) {
        AdFrequency.Limits limits = frequency.limits();
        boolean firstDay = frequency.signedUpAt(userId)
                .map(signedUp -> now.isBefore(signedUp.plus(FIRST_DAY)))
                .orElse(false);
        int cap = firstDay ? limits.firstDayCap() : limits.windowCap();
        return frequency.servedSince(userId, now.minus(Duration.ofMinutes(limits.windowMinutes()))) >= cap;
    }

    /** @return 광고가 없으면 false */
    public boolean record(UUID userId, UUID adId, AdSlot slot, Event event) {
        if (repository.find(adId).isEmpty()) {
            return false;
        }
        Instant now = clock.instant();
        if (event == Event.IMPRESSION) {
            repository.recordImpression(adId, userId, slot.key(), today(now), now);
        } else {
            repository.recordClick(adId, userId, slot.key(), today(now), now);
        }
        return true;
    }

    private static LocalDate today(Instant now) {
        return LocalDate.ofInstant(now, SEOUL);
    }
}
