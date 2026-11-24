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
        assertThat(PosterRules.check(with(draft(), "ctaAction", "route", "ctaTarget", "/reading"))).isEmpty();
        assertThat(PosterRules.check(with(draft(), "ctaAction", "url", "ctaTarget", "https://acttub.com/a"))).isEmpty();
        assertThat(PosterRules.check(with(draft(), "image", "posters/" + UUID.randomUUID() + ".jpg"))).isEmpty();
    }

    @Test
    void everyEntryIsAnAcceptedFrequency() {
        assertThat(PosterRules.check(with(draft(), "frequency", "every"))).isEmpty();
    }

    @Test
    void eachRuleNamesTheFieldItBreaks() {
        assertThat(field(with(draft(), "slug", "Bad Slug"))).isEqualTo("slug");
        assertThat(field(with(draft(), "slug", ""))).isEqualTo("slug");
        assertThat(field(with(draft(), "title", "  "))).isEqualTo("title");
        assertThat(field(with(draft(), "title", null))).isEqualTo("title");
        assertThat(field(with(draft(), "platforms", List.of()))).isEqualTo("platforms");
        assertThat(field(with(draft(), "platforms", List.of("ios", "web")))).isEqualTo("platforms");
        assertThat(field(with(draft(), "platforms", List.of("ios", "ios")))).isEqualTo("platforms");
        assertThat(field(with(draft(), "locale", "korean"))).isEqualTo("locale");
        assertThat(field(with(draft(), "minAppVersion", "0.1.x"))).isEqualTo("min_app_version");
        assertThat(field(with(draft(), "frequency", "weekly"))).isEqualTo("frequency");
        assertThat(field(with(draft(), "audience", "everyone"))).isEqualTo("audience");
        assertThat(field(with(draft(), "image", "https://example.com/a.png"))).isEqualTo("image");
        assertThat(field(with(draft(), "audio", "posters/x.mp3"))).isEqualTo("audio");
        assertThat(field(with(draft(), "ctaAction", "open", "ctaTarget", null))).isEqualTo("cta_action");
        assertThat(field(with(draft(), "ctaAction", "url", "ctaTarget", null))).isEqualTo("cta_target");
        assertThat(field(with(draft(), "ctaAction", "url", "ctaTarget", "http://acttub.com"))).isEqualTo("cta_target");
        assertThat(field(with(draft(), "ctaAction", "route", "ctaTarget", "reading"))).isEqualTo("cta_target");
        assertThat(field(with(draft(), "startsAt", NOW, "endsAt", NOW))).isEqualTo("ends_at");
    }

    @Test
    void selectionDropsPostersTheAppIsTooOldForAndKeepsAtMostFive() {
        List<Poster> candidates = new ArrayList<>();
        candidates.add(poster("needs-new", with(draft(), "slug", "needs-new", "minAppVersion", "0.1.10")));
        for (int index = 0; index < 6; index++) {
            candidates.add(poster("p" + index, with(draft(), "slug", "p" + index)));
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

    /** 초안에서 칸 몇 개만 바꾼 사본. {@code changes} 는 칸 이름(레코드 성분 이름)과 값을 번갈아 준다. */
    private static PosterDraft with(PosterDraft draft, Object... changes) {
        var values = new java.util.HashMap<String, Object>();
        for (int i = 0; i < changes.length; i += 2) values.put((String) changes[i], changes[i + 1]);
        var components = PosterDraft.class.getRecordComponents();
        Object[] arguments = new Object[components.length];
        Class<?>[] types = new Class<?>[components.length];
        try {
            for (int i = 0; i < components.length; i++) {
                types[i] = components[i].getType();
                String name = components[i].getName();
                arguments[i] = values.containsKey(name) ? values.remove(name) : components[i].getAccessor().invoke(draft);
            }
            if (!values.isEmpty()) throw new IllegalArgumentException("unknown poster fields " + values.keySet());
            return PosterDraft.class.getDeclaredConstructor(types).newInstance(arguments);
        } catch (ReflectiveOperationException failure) {
            throw new IllegalStateException(failure);
        }
    }

    private static PosterDraft draft() {
        return new PosterDraft("cloud-voice-launch", true, 10, null, null, List.of("ios", "android"), "ko", null,
                "daily", "all", true, "배지", "제목", "본문", "asset:mascot-reading", "asset:cloud-voice-sample",
                "켜기", "cloud_voice_enable", null, null, null);
    }

    @Test
    void aVersionLongerThanTheLimitIsInvalidWithoutReachingTheRegex() {
        // 수정 전에는 StackOverflowError 가 났다
        assertThat(PosterRules.validVersion("1.".repeat(50_000) + "1")).isFalse();
        assertThat(PosterRules.validVersion("1".repeat(64))).isTrue();
        assertThat(PosterRules.validVersion("1".repeat(65))).isFalse();
    }
}
