package com.acttub.actingapi.feature.ads.app;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import com.acttub.actingapi.feature.ads.domain.Ad;
import com.acttub.actingapi.feature.ads.domain.AdPicker;
import com.acttub.actingapi.feature.ads.domain.AdSlot;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

class AdServiceTest {
    // 한국 시각 10/27 00:30 — UTC 로는 아직 10/26 이다.
    private static final Clock CLOCK = Clock.fixed(Instant.parse("2026-10-26T15:30:00Z"), ZoneOffset.UTC);
    private static final UUID USER = UUID.randomUUID();

    static final class FakeRepository implements AdRepository {
        boolean practiced = true;
        final List<Ad> ads = new ArrayList<>();
        final List<String> events = new ArrayList<>();

        @Override
        public List<Ad> activeFor(String slotKey, Instant now) {
            return ads.stream().filter(ad -> ad.slots().contains(slotKey)).toList();
        }

        @Override
        public Optional<Ad> find(UUID adId) {
            return ads.stream().filter(ad -> ad.id().equals(adId)).findFirst();
        }

        @Override
        public boolean practiced(UUID userId) {
            return practiced;
        }

        @Override
        public boolean recordImpression(UUID adId, UUID userId, String slotKey, LocalDate day, Instant now) {
            events.add("impression:" + slotKey + ":" + day);
            return true;
        }

        @Override
        public void recordClick(UUID adId, UUID userId, String slotKey, LocalDate day, Instant now) {
            events.add("click:" + slotKey + ":" + day);
        }
    }

    private static Ad direct() {
        return new Ad(UUID.randomUUID(), Ad.DIRECT, List.of("home_top"), "all", 0, "학원", null, null, null,
                null, null, null, "b.png", null, "https://example.com", null);
    }

    @Test
    @DisplayName("꺼 두면(ADS_ENABLED=false) 모두 NONE, 첫 연습 전도 NONE")
    void disabledAndFirstTime() {
        FakeRepository repo = new FakeRepository();
        repo.ads.add(direct());
        var off = new AdService(repo, ProStatusReader.ALWAYS_FREE, new AdService.Settings(false, 50), CLOCK);
        assertThat(off.pick(USER, AdSlot.HOME_TOP).kind()).isEqualTo(AdPicker.Kind.NONE);
        repo.practiced = false;
        var on = new AdService(repo, ProStatusReader.ALWAYS_FREE, new AdService.Settings(true, 50), CLOCK);
        assertThat(on.pick(USER, AdSlot.HOME_TOP).kind()).isEqualTo(AdPicker.Kind.NONE);
    }

    @Test
    @DisplayName("Pro 판정을 결제 도메인에 묻고, 연습 중 칸 비율 0% 면 무료도 NONE, 100% 면 채운다")
    void proAndPercent() {
        FakeRepository repo = new FakeRepository();
        var pro = new AdService(repo, userId -> true, new AdService.Settings(true, 100), CLOCK);
        assertThat(pro.pick(USER, AdSlot.UPLOAD_WAIT).kind()).isEqualTo(AdPicker.Kind.NONE);
        assertThat(pro.pick(USER, AdSlot.HOME_TOP).kind()).isEqualTo(AdPicker.Kind.NETWORK);
        var none = new AdService(repo, ProStatusReader.ALWAYS_FREE, new AdService.Settings(true, 0), CLOCK);
        assertThat(none.pick(USER, AdSlot.UPLOAD_WAIT).kind()).isEqualTo(AdPicker.Kind.NONE);
        var all = new AdService(repo, ProStatusReader.ALWAYS_FREE, new AdService.Settings(true, 100), CLOCK);
        assertThat(all.pick(USER, AdSlot.UPLOAD_WAIT).kind()).isEqualTo(AdPicker.Kind.NETWORK);
    }

    @Test
    @DisplayName("기록은 한국 날짜로 남고, 없는 광고면 false · 상세는 직접 광고만")
    void recordUsesSeoulDay() {
        FakeRepository repo = new FakeRepository();
        Ad ad = direct();
        repo.ads.add(ad);
        var service = new AdService(repo, ProStatusReader.ALWAYS_FREE, new AdService.Settings(true, 50), CLOCK);
        assertThat(service.record(USER, ad.id(), AdSlot.HOME_TOP, AdService.Event.IMPRESSION)).isTrue();
        assertThat(service.record(USER, ad.id(), AdSlot.HOME_TOP, AdService.Event.CLICK)).isTrue();
        assertThat(service.record(USER, UUID.randomUUID(), AdSlot.HOME_TOP, AdService.Event.CLICK)).isFalse();
        assertThat(repo.events).containsExactly("impression:home_top:2026-10-27", "click:home_top:2026-10-27");
        assertThat(service.direct(ad.id())).contains(ad);
    }
}
