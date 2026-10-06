package com.acttub.actingapi.feature.poster.domain;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import org.junit.jupiter.api.Test;

/** app.poster 의 순수 규칙 — 판 비교, 자산 표기, 포스터 값 검사, 앱에 낼 것 고르기. */
class PosterRulesTest {

    private static final Instant NOW = Instant.parse("2026-10-05T00:00:00Z");

    @Test
    void versionsCompareAsDotSeparatedIntegers() {
        assertThat(PosterRules.compareVersions("0.1.10", "0.1.9")).isPositive();
        assertThat(PosterRules.compareVersions("0.1.9", "0.1.10")).isNegative();
        assertThat(PosterRules.compareVersions("0.1.3", "0.1.3")).isZero();
        assertThat(PosterRules.compareVersions("1.0", "1.0.0")).isZero();
        assertThat(PosterRules.compareVersions("1.0.1", "1.0")).isPositive();
        assertThat(PosterRules.compareVersions("10.0.0", "9.99.99")).isPositive();
    }

    @Test
    void onlyDotSeparatedNumbersAreVersions() {
        assertThat(PosterRules.validVersion("0.1.3")).isTrue();
        assertThat(PosterRules.validVersion("12")).isTrue();
        assertThat(PosterRules.validVersion("0.1.")).isFalse();
        assertThat(PosterRules.validVersion("v0.1.3")).isFalse();
        assertThat(PosterRules.validVersion("0.1.3-beta")).isFalse();
        assertThat(PosterRules.validVersion("")).isFalse();
        assertThat(PosterRules.validVersion(null)).isFalse();
    }

    @Test
    void minimumVersionExcludesOlderAppsAndAppsThatDoNotSayTheirVersion() {
        assertThat(PosterRules.fitsVersion(null, null)).isTrue();
        assertThat(PosterRules.fitsVersion(null, "0.0.1")).isTrue();
        assertThat(PosterRules.fitsVersion("0.1.10", "0.1.10")).isTrue();
        assertThat(PosterRules.fitsVersion("0.1.10", "0.2.0")).isTrue();
        assertThat(PosterRules.fitsVersion("0.1.10", "0.1.9")).isFalse();
        assertThat(PosterRules.fitsVersion("0.1.3", null)).isFalse();
    }

    @Test
    void assetReferencesAndObjectKeysAreToldApart() {
        assertThat(PosterRules.assetName("asset:mascot-reading")).isEqualTo("mascot-reading");
        assertThat(PosterRules.assetName("posters/" + UUID.randomUUID() + ".png")).isNull();
        assertThat(PosterRules.assetName(null)).isNull();
        assertThat(PosterRules.isObjectKey("posters/" + UUID.randomUUID() + ".webp")).isTrue();
        assertThat(PosterRules.isObjectKey("asset:mascot-reading")).isFalse();
        assertThat(PosterRules.isObjectKey("users/x/profile/a.png")).isFalse();
        assertThat(PosterRules.isObjectKey(null)).isFalse();
    }

    @Test
    void aWellFormedDraftHasNoViolation() {
        assertThat(PosterRules.check(draft())).isEmpty();
        assertThat(PosterRules.check(draft().withCta("route", "/reading"))).isEmpty();
        assertThat(PosterRules.check(draft().withCta("url", "https://acttub.com/a"))).isEmpty();
        assertThat(PosterRules.check(draft().withImage("posters/" + UUID.randomUUID() + ".jpg"))).isEmpty();
    }

    @Test
    void eachRuleNamesTheFieldItBreaks() {
        assertThat(field(draft().withSlug("Bad Slug"))).isEqualTo("slug");
        assertThat(field(draft().withSlug(""))).isEqualTo("slug");
        assertThat(field(draft().withTitle("  "))).isEqualTo("title");
        assertThat(field(draft().withTitle(null))).isEqualTo("title");
        assertThat(field(draft().withPlatforms(List.of()))).isEqualTo("platforms");
        assertThat(field(draft().withPlatforms(List.of("ios", "web")))).isEqualTo("platforms");
        assertThat(field(draft().withPlatforms(List.of("ios", "ios")))).isEqualTo("platforms");
        assertThat(field(draft().withLocale("korean"))).isEqualTo("locale");
        assertThat(field(draft().withMinAppVersion("0.1.x"))).isEqualTo("min_app_version");
        assertThat(field(draft().withFrequency("weekly"))).isEqualTo("frequency");
        assertThat(field(draft().withAudience("everyone"))).isEqualTo("audience");
        assertThat(field(draft().withImage("https://example.com/a.png"))).isEqualTo("image");
        assertThat(field(draft().withAudio("posters/x.mp3"))).isEqualTo("audio");
        assertThat(field(draft().withCta("open", null))).isEqualTo("cta_action");
        assertThat(field(draft().withCta("url", null))).isEqualTo("cta_target");
        assertThat(field(draft().withCta("url", "http://acttub.com"))).isEqualTo("cta_target");
        assertThat(field(draft().withCta("route", "reading"))).isEqualTo("cta_target");
        assertThat(field(draft().withPeriod(NOW, NOW))).isEqualTo("ends_at");
    }

    @Test
    void selectionDropsPostersTheAppIsTooOldForAndKeepsAtMostFive() {
        List<Poster> candidates = new ArrayList<>();
        candidates.add(poster("needs-new", draft().withSlug("needs-new").withMinAppVersion("0.1.10")));
        for (int index = 0; index < 6; index++) {
            candidates.add(poster("p" + index, draft().withSlug("p" + index)));
        }

        assertThat(PosterRules.forApp(candidates, "0.1.9")).extracting(poster -> poster.draft().slug())
                .containsExactly("p0", "p1", "p2", "p3", "p4");
        assertThat(PosterRules.forApp(candidates, "0.1.10")).extracting(poster -> poster.draft().slug())
                .containsExactly("needs-new", "p0", "p1", "p2", "p3");
        assertThat(PosterRules.forApp(candidates, null)).extracting(poster -> poster.draft().slug())
                .containsExactly("p0", "p1", "p2", "p3", "p4");
    }

    private static String field(PosterDraft draft) {
        return PosterRules.check(draft).map(PosterRules.Violation::field).orElse(null);
    }

    private static Poster poster(String slug, PosterDraft draft) {
        return new Poster(UUID.randomUUID(), 1, draft, NOW, NOW);
    }

    private static PosterDraft draft() {
        return new PosterDraft("cloud-voice-launch", true, 10, null, null, List.of("ios", "android"), "ko", null,
                "daily", "all", true, "배지", "제목", "본문", "asset:mascot-reading", "asset:cloud-voice-sample",
                "켜기", "cloud_voice_enable", null);
    }
}
