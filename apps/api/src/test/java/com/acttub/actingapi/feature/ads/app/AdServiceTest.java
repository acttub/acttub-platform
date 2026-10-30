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
import com.acttub.actingapi.feature.ads.domain.AdDraft;
import com.acttub.actingapi.feature.ads.domain.AdStats;
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
        public List<AdStats.Stored> all() {
            throw new UnsupportedOperationException();
        }

        @Override
        public Optional<AdStats.Stored> findStored(UUID adId) {
            throw new UnsupportedOperationException();
        }

        @Override
        public AdStats.Stored insert(AdDraft draft, Instant now) {
            throw new UnsupportedOperationException();
        }

        @Override
        public Optional<AdStats.Stored> update(UUID adId, AdDraft draft, Instant now) {
            throw new UnsupportedOperationException();
        }

        @Override
        public List<AdStats.Day> dailyEvents(UUID adId, LocalDate from, LocalDate to) {
            throw new UnsupportedOperationException();
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
        return new Ad(UUID.randomUUID(), Ad.DIRECT, List.of("home_top"), "all", 0, "학원",
                null, null, null, "b.png", null, "https://example.com", null, 50);
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
    @DisplayName("서버에서 꺼 둔 칸만 NONE, 나머지 칸은 그대로 고른다")
    void slotSwitch() {
        FakeRepository repo = new FakeRepository();
        repo.ads.add(direct());
        AdSlotSwitches homeOff = slotKey -> "home_top".equals(slotKey);
        var service = new AdService(repo, ProStatusReader.ALWAYS_FREE, new AdService.Settings(true, 100), homeOff, CLOCK);
        assertThat(service.pick(USER, AdSlot.HOME_TOP).kind()).isEqualTo(AdPicker.Kind.NONE);
        assertThat(service.pick(USER, AdSlot.SETTINGS_TOP).kind()).isEqualTo(AdPicker.Kind.NETWORK);
        assertThat(service.pick(USER, AdSlot.UPLOAD_WAIT).kind()).isEqualTo(AdPicker.Kind.NETWORK);
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

    static final class FakeFrequency implements AdFrequency {
        Limits limits = new Limits(10, 5, 3);
        Instant signedUp = Instant.parse("2026-01-01T00:00:00Z");
        final List<Instant> serves = new ArrayList<>();

        @Override
        public Limits limits() {
            return limits;
        }

        @Override
        public Limits update(Limits next, Instant now) {
            limits = next;
            return next;
        }

        @Override
        public int servedSince(UUID userId, Instant since) {
            return (int) serves.stream().filter(at -> at.isAfter(since)).count();
        }

        @Override
        public Optional<Instant> signedUpAt(UUID userId) {
            return Optional.ofNullable(signedUp);
        }

        @Override
        public void recordServe(UUID userId, Instant at) {
            serves.add(at);
        }

        @Override
        public int purgeBefore(Instant before) {
            return 0;
        }
    }

    private static AdService limited(FakeRepository repo, FakeFrequency frequency, Clock clock) {
        return new AdService(repo, ProStatusReader.ALWAYS_FREE, new AdService.Settings(true, 100),
                AdSlotSwitches.ALWAYS_ON, frequency, clock);
    }

    @Test
    @DisplayName("10분에 5개를 내보냈으면 그 뒤는 NONE, 창이 지나면 다시 나온다")
    void windowCap() {
        FakeRepository repo = new FakeRepository();
        FakeFrequency frequency = new FakeFrequency();
        for (int i = 0; i < 5; i++) {
            assertThat(limited(repo, frequency, CLOCK).pick(USER, AdSlot.HOME_TOP).kind()).isEqualTo(AdPicker.Kind.NETWORK);
        }
        assertThat(limited(repo, frequency, CLOCK).pick(USER, AdSlot.HOME_TOP).kind()).isEqualTo(AdPicker.Kind.NONE);
        assertThat(frequency.serves).hasSize(5);
        Clock later = Clock.fixed(CLOCK.instant().plusSeconds(10 * 60 + 1), ZoneOffset.UTC);
        assertThat(limited(repo, frequency, later).pick(USER, AdSlot.HOME_TOP).kind()).isEqualTo(AdPicker.Kind.NETWORK);
    }

    @Test
    @DisplayName("직접·자체 광고도 센다, NONE 은 세지 않는다")
    void countsEveryKindButNone() {
        FakeRepository repo = new FakeRepository();
        repo.ads.add(direct());
        FakeFrequency frequency = new FakeFrequency();
        var service = limited(repo, frequency, CLOCK);
        assertThat(service.pick(USER, AdSlot.HOME_TOP).kind()).isEqualTo(AdPicker.Kind.DIRECT);
        assertThat(frequency.serves).hasSize(1);
        repo.practiced = false;
        for (int i = 0; i < 10; i++) {
            assertThat(service.pick(USER, AdSlot.HOME_TOP).kind()).isEqualTo(AdPicker.Kind.NONE);
        }
        assertThat(frequency.serves).hasSize(1);
        repo.practiced = true;
        for (int i = 0; i < 4; i++) {
            service.pick(USER, AdSlot.HOME_TOP);
        }
        assertThat(frequency.serves).hasSize(5);
        assertThat(service.pick(USER, AdSlot.HOME_TOP).kind()).isEqualTo(AdPicker.Kind.NONE);
    }

    @Test
    @DisplayName("가입 24시간 이내는 첫날 상한(3개), 24시간이 지나면 보통 상한")
    void firstDayCap() {
        FakeRepository repo = new FakeRepository();
        FakeFrequency frequency = new FakeFrequency();
        frequency.signedUp = CLOCK.instant().minusSeconds(23 * 3600);
        for (int i = 0; i < 3; i++) {
            assertThat(limited(repo, frequency, CLOCK).pick(USER, AdSlot.HOME_TOP).kind()).isEqualTo(AdPicker.Kind.NETWORK);
        }
        assertThat(limited(repo, frequency, CLOCK).pick(USER, AdSlot.HOME_TOP).kind()).isEqualTo(AdPicker.Kind.NONE);
        frequency.serves.clear();
        frequency.signedUp = CLOCK.instant().minusSeconds(25 * 3600);
        for (int i = 0; i < 5; i++) {
            assertThat(limited(repo, frequency, CLOCK).pick(USER, AdSlot.HOME_TOP).kind()).isEqualTo(AdPicker.Kind.NETWORK);
        }
        assertThat(limited(repo, frequency, CLOCK).pick(USER, AdSlot.HOME_TOP).kind()).isEqualTo(AdPicker.Kind.NONE);
    }

    @Test
    @DisplayName("상한을 0 으로 두면 늘 NONE, 설정을 바꾸면 바로 따른다")
    void settingsApply() {
        FakeRepository repo = new FakeRepository();
        FakeFrequency frequency = new FakeFrequency();
        frequency.limits = new AdFrequency.Limits(10, 0, 0);
        assertThat(limited(repo, frequency, CLOCK).pick(USER, AdSlot.HOME_TOP).kind()).isEqualTo(AdPicker.Kind.NONE);
        frequency.limits = new AdFrequency.Limits(10, 1, 1);
        assertThat(limited(repo, frequency, CLOCK).pick(USER, AdSlot.HOME_TOP).kind()).isEqualTo(AdPicker.Kind.NETWORK);
        assertThat(limited(repo, frequency, CLOCK).pick(USER, AdSlot.HOME_TOP).kind()).isEqualTo(AdPicker.Kind.NONE);
        assertThat(new AdFrequency.Limits(0, 5, 3).valid()).isFalse();
        assertThat(new AdFrequency.Limits(1440, 100, 0).valid()).isTrue();
        assertThat(new AdFrequency.Limits(10, 101, 3).valid()).isFalse();
    }

    @Test
    @DisplayName("기록은 한국 날짜로 남고, 없는 광고면 false")
    void recordUsesSeoulDay() {
        FakeRepository repo = new FakeRepository();
        Ad ad = direct();
        repo.ads.add(ad);
        var service = new AdService(repo, ProStatusReader.ALWAYS_FREE, new AdService.Settings(true, 50), CLOCK);
        assertThat(service.record(USER, ad.id(), AdSlot.HOME_TOP, AdService.Event.IMPRESSION)).isTrue();
        assertThat(service.record(USER, ad.id(), AdSlot.HOME_TOP, AdService.Event.CLICK)).isTrue();
        assertThat(service.record(USER, UUID.randomUUID(), AdSlot.HOME_TOP, AdService.Event.CLICK)).isFalse();
        assertThat(repo.events).containsExactly("impression:home_top:2026-10-27", "click:home_top:2026-10-27");
    }
}
