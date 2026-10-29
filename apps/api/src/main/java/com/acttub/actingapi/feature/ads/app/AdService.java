package com.acttub.actingapi.feature.ads.app;

import java.time.Clock;
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
 * (기본 50)% 의 무료 사용자에게만 켠다.
 */
public class AdService {
    private static final ZoneId SEOUL = ZoneId.of("Asia/Seoul");

    public record Settings(boolean enabled, int practiceSlotPercent) {
    }

    public enum Event { IMPRESSION, CLICK }

    private final AdRepository repository;
    private final ProStatusReader proStatus;
    private final Settings settings;
    private final Clock clock;

    public AdService(AdRepository repository, ProStatusReader proStatus, Settings settings, Clock clock) {
        this.repository = repository;
        this.proStatus = proStatus;
        this.settings = settings;
        this.clock = clock;
    }

    public AdPicker.Pick pick(UUID userId, AdSlot slot) {
        if (!settings.enabled()) {
            return new AdPicker.Pick(AdPicker.Kind.NONE, slot, null);
        }
        boolean practiced = repository.practiced(userId);
        if (!practiced) {
            return new AdPicker.Pick(AdPicker.Kind.NONE, slot, null);
        }
        Instant now = clock.instant();
        AdPicker.Viewer viewer = new AdPicker.Viewer(
                userId, true, proStatus.pro(userId), AdPicker.practiceOn(userId, settings.practiceSlotPercent()));
        return AdPicker.pick(slot, viewer, repository.activeFor(slot.key(), now), today(now));
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
