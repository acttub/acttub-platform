package com.acttub.actingapi.feature.ads.domain;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import java.util.stream.IntStream;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

class AdPickerTest {
    private static final LocalDate DAY = LocalDate.of(2026, 10, 26);
    private static final UUID USER = UUID.fromString("00000000-0000-0000-0000-000000000001");

    private static Ad direct(String slot, String large, String banner, int priority) {
        return new Ad(UUID.randomUUID(), Ad.DIRECT, List.of(slot), "all", priority, "학원",
                null, null, large, banner, null, "https://example.com", null);
    }

    private static Ad house(String slot, String audience, String headline, String path) {
        return new Ad(UUID.randomUUID(), Ad.HOUSE, List.of(slot), audience, 0, null,
                headline, null, null, null, null, null, path);
    }

    private static AdPicker.Viewer viewer(boolean practiced, boolean pro, boolean practiceOn) {
        return new AdPicker.Viewer(USER, practiced, pro, practiceOn);
    }

    @Test
    @DisplayName("첫 연습 전이면 어떤 칸이든 NONE")
    void noneBeforeFirstPractice() {
        var pick = AdPicker.pick(AdSlot.HOME_TOP, viewer(false, false, true),
                List.of(direct("home_top", null, "b.png", 0)), DAY);
        assertThat(pick.kind()).isEqualTo(AdPicker.Kind.NONE);
    }

    @Test
    @DisplayName("직접 광고가 자체 광고보다 먼저고, 칸 규격 이미지가 없는 직접 광고는 건너뛴다")
    void directBeforeHouseAndNeedsSizedImage() {
        Ad wrongSize = direct("home_top", "large.png", null, 9);
        Ad fits = direct("home_top", null, "banner.png", 0);
        Ad ours = house("home_top", "all", "이번 주 챌린지", "/challenges");
        var pick = AdPicker.pick(AdSlot.HOME_TOP, viewer(true, false, false), List.of(wrongSize, ours, fits), DAY);
        assertThat(pick.kind()).isEqualTo(AdPicker.Kind.DIRECT);
        assertThat(pick.ad()).isEqualTo(fits);

        var housePick = AdPicker.pick(AdSlot.HOME_TOP, viewer(true, false, false), List.of(wrongSize, ours), DAY);
        assertThat(housePick.kind()).isEqualTo(AdPicker.Kind.HOUSE);
        assertThat(housePick.ad()).isEqualTo(ours);
    }

    @Test
    @DisplayName("Pro 에게 Pro 권유(대상 free)는 안 가고 AdMob 으로 채운다 — 둘러보기 칸은 Pro 도 본다")
    void proSkipsFreeOnlyHouseButStillSeesNetwork() {
        Ad upsell = house("profile_top", "free", "Pro 로 더 연습하기", "/pro");
        var pro = AdPicker.pick(AdSlot.PROFILE_TOP, viewer(true, true, false), List.of(upsell), DAY);
        assertThat(pro.kind()).isEqualTo(AdPicker.Kind.NETWORK);
        var free = AdPicker.pick(AdSlot.PROFILE_TOP, viewer(true, false, false), List.of(upsell), DAY);
        assertThat(free.kind()).isEqualTo(AdPicker.Kind.HOUSE);
    }

    @Test
    @DisplayName("연습 중 칸은 Pro 면 NONE, 무료라도 A/B 꺼진 쪽이면 NONE, 켠 쪽이면 채운다")
    void practiceSlots() {
        assertThat(AdPicker.pick(AdSlot.ANALYZING_WAIT, viewer(true, true, true), List.of(), DAY).kind())
                .isEqualTo(AdPicker.Kind.NONE);
        assertThat(AdPicker.pick(AdSlot.ANALYZING_WAIT, viewer(true, false, false), List.of(), DAY).kind())
                .isEqualTo(AdPicker.Kind.NONE);
        assertThat(AdPicker.pick(AdSlot.ANALYZING_WAIT, viewer(true, false, true), List.of(), DAY).kind())
                .isEqualTo(AdPicker.Kind.NETWORK);
    }

    @Test
    @DisplayName("다른 칸 광고와 앱 안 경로가 없는 자체 광고는 고르지 않는다")
    void targetsAndPath() {
        var pick = AdPicker.pick(AdSlot.HOME_TOP, viewer(true, false, false),
                List.of(direct("profile_top", null, "b.png", 0), house("home_top", "all", "문구", "https://x")), DAY);
        assertThat(pick.kind()).isEqualTo(AdPicker.Kind.NETWORK);
    }

    @Test
    @DisplayName("A/B 배정은 같은 사람에게 늘 같고, 0%·100% 는 끝값이며 50% 는 대략 절반이다")
    void practiceBucket() {
        assertThat(AdPicker.practiceOn(USER, 50)).isEqualTo(AdPicker.practiceOn(USER, 50));
        assertThat(AdPicker.practiceOn(USER, 0)).isFalse();
        assertThat(AdPicker.practiceOn(USER, 100)).isTrue();
        assertThat(AdPicker.practiceOn(USER, 150)).isTrue();
        long on = IntStream.range(0, 2000).filter(i -> AdPicker.practiceOn(UUID.randomUUID(), 50)).count();
        assertThat(on).isBetween(850L, 1150L);
    }

    @Test
    @DisplayName("같은 우선순위 후보는 사람·날마다 하나로 고정해 돌리고, 더 큰 우선순위가 이긴다")
    void rotationIsStable() {
        Ad a = direct("home_top", null, "a.png", 0);
        Ad b = direct("home_top", null, "b.png", 0);
        Ad top = direct("home_top", null, "t.png", 5);
        var first = AdPicker.pick(AdSlot.HOME_TOP, viewer(true, false, false), List.of(a, b), DAY).ad();
        assertThat(AdPicker.pick(AdSlot.HOME_TOP, viewer(true, false, false), List.of(b, a), DAY).ad()).isEqualTo(first);
        assertThat(AdPicker.pick(AdSlot.HOME_TOP, viewer(true, false, false), List.of(a, b, top), DAY).ad()).isEqualTo(top);
    }

    @Test
    @DisplayName("칸 키는 겹치지 않고 규격이 정해져 있다")
    void slotKeys() {
        assertThat(AdSlot.values()).extracting(AdSlot::key).doesNotHaveDuplicates();
        assertThat(AdSlot.of("analyzing_wait")).contains(AdSlot.ANALYZING_WAIT);
        assertThat(AdSlot.ANALYZING_WAIT.size()).isEqualTo(AdSize.MEDIUM_RECTANGLE);
        assertThat(AdSlot.of("nope")).isEmpty();
    }
}
