package com.acttub.actingapi.feature.ads.domain;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.util.List;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

class AdRulesTest {
    private static final String KEY = "ads/banner/0b1c2d3e-0000-4000-8000-00000000abcd.png";

    private static AdDraft direct(List<String> slots, String banner, String link) {
        return new AdDraft(Ad.DIRECT, "active", slots, "all", 0, "한빛연기학원", null, null, null, banner, null, link, null,
                null, null);
    }

    @Test
    @DisplayName("직접 광고는 광고주 이름·http(s) 링크·칸 규격 이미지만 있으면 된다(학원 전용 칸 없이)")
    void directNeedsNameLinkAndSlotImage() {
        assertThat(AdRules.check(direct(List.of("home_top"), KEY, "https://example.com/a?b=1"))).isEmpty();
        assertThat(AdRules.check(direct(List.of("home_top"), "https://cdn.example.com/b.png", "http://example.com"))).isEmpty();
        assertThat(AdRules.check(direct(List.of(), null, "https://example.com"))).isEmpty();

        assertThat(AdRules.check(direct(List.of("home_top"), KEY, null)).orElseThrow().field()).isEqualTo("link_url");
        assertThat(AdRules.check(direct(List.of("home_top"), KEY, "ftp://example.com")).orElseThrow().field()).isEqualTo("link_url");
        assertThat(AdRules.check(direct(List.of("home_top"), KEY, "javascript:alert(1)")).orElseThrow().field()).isEqualTo("link_url");
        assertThat(AdRules.check(direct(List.of("home_top"), KEY, "https://")).orElseThrow().field()).isEqualTo("link_url");
        // home_top 은 BANNER(320x50) 인데 이미지가 없다
        assertThat(AdRules.check(direct(List.of("home_top"), null, "https://example.com")).orElseThrow().field())
                .isEqualTo("image_banner");
        // 칸 규격과 다른 규격 이미지(large_banner 폴더)를 banner 칸에 넣을 수 없다
        assertThat(AdRules.check(direct(List.of("home_top"),
                "ads/large_banner/0b1c2d3e-0000-4000-8000-00000000abcd.png", "https://example.com")).orElseThrow().field())
                .isEqualTo("image_banner");
        assertThat(AdRules.check(direct(List.of("nope"), KEY, "https://example.com")).orElseThrow().field()).isEqualTo("slots");
    }

    @Test
    @DisplayName("자체 광고는 /로 시작하는 앱 경로와 이미지나 문구, 기간은 끝이 시작 뒤")
    void houseAndPeriod() {
        AdDraft house = new AdDraft(Ad.HOUSE, "paused", List.of("home_top"), "free", 3, null, "Pro 를 써 보세요", null, null,
                null, null, null, "/pro", null, null);
        assertThat(AdRules.check(house)).isEmpty();
        assertThat(AdRules.check(new AdDraft(Ad.HOUSE, "paused", List.of(), "free", 3, null, "문구", null, null, null,
                null, null, "pro", null, null)).orElseThrow().field()).isEqualTo("app_path");
        assertThat(AdRules.check(new AdDraft(Ad.HOUSE, "paused", List.of(), "free", 3, null, null, null, null, null,
                null, null, "/pro", null, null)).orElseThrow().field()).isEqualTo("headline");
        Instant t = Instant.parse("2026-11-01T00:00:00Z");
        assertThat(AdRules.check(new AdDraft(Ad.HOUSE, "active", List.of(), "all", 0, null, "문구", null, null, null, null,
                null, "/pro", t, t)).orElseThrow().field()).isEqualTo("ends_at");
        assertThat(AdRules.check(new AdDraft("x", "active", List.of(), "all", 0, null, null, null, null, null, null, null,
                null, null, null)).orElseThrow().field()).isEqualTo("kind");
        assertThat(AdRules.check(new AdDraft(Ad.HOUSE, "gone", List.of(), "all", 0, null, "문구", null, null, null, null,
                null, "/pro", null, null)).orElseThrow().field()).isEqualTo("status");
    }
}
