package com.acttub.actingapi.feature.poster.domain;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

import org.junit.jupiter.api.Test;

/** 비어 있거나 모양이 틀린 칸마다 첫 위반으로 그 칸이 나온다 (app.poster). */
class PosterRulesMissingFieldTest {
    private static final Instant START = Instant.parse("2026-10-20T00:00:00Z");

    private static PosterDraft draft(String slug, List<String> platforms, String minAppVersion, Instant endsAt,
            String frequency, String audience, String audio, String ctaAction) {
        return new PosterDraft(slug, true, 1, START, endsAt, platforms, null, minAppVersion, frequency, audience,
                true, null, "제목", "본문", null, audio, null, ctaAction, null, null, null);
    }

    private static PosterDraft valid() {
        return draft("autumn", List.of("ios"), null, null, "daily", "all", null, "none");
    }

    private static Optional<PosterRules.Violation> check(PosterDraft draft) {
        return PosterRules.check(draft);
    }

    @Test
    void theBaseDraftIsValid() {
        assertThat(check(valid())).isEmpty();
        assertThat(check(draft("autumn", List.of("ios"), "0.1.2", START.plusSeconds(1), "once", "all",
                "asset:chime", "none"))).isEmpty();
    }

    @Test
    void missingOrMalformedFieldsAreReportedOneAtATime() {
        assertThat(check(draft(null, List.of("ios"), null, null, "daily", "all", null, "none")))
                .contains(new PosterRules.Violation("slug",
                        "Value error, slug must be 1-64 lowercase letters, digits or hyphens", null));
        assertThat(check(draft("autumn", null, null, null, "daily", "all", null, "none")))
                .contains(new PosterRules.Violation("platforms",
                        "Value error, platforms must be distinct values of ios, android", null));
        assertThat(check(draft("autumn", List.of("ios"), "1.x", null, "daily", "all", null, "none")))
                .contains(new PosterRules.Violation("min_app_version",
                        "Value error, min_app_version must be dot-separated numbers", "1.x"));
        assertThat(check(draft("autumn", List.of("ios"), null, START, "daily", "all", null, "none")))
                .contains(new PosterRules.Violation("ends_at", "Value error, ends_at must be after starts_at", START.toString()));
        assertThat(check(draft("autumn", List.of("ios"), null, null, null, "all", null, "none")))
                .contains(new PosterRules.Violation("frequency", "Value error, frequency must be daily, once or every", null));
        assertThat(check(draft("autumn", List.of("ios"), null, null, "daily", null, null, "none")))
                .contains(new PosterRules.Violation("audience", "Value error, audience must be all or cloud_voice_off", null));
        assertThat(check(draft("autumn", List.of("ios"), null, null, "daily", "all", "https://cdn/x.mp3", "none")))
                .contains(new PosterRules.Violation("audio",
                        "Value error, audio must be asset:<name> or posters/<uuid>.<ext>", "https://cdn/x.mp3"));
        assertThat(check(draft("autumn", List.of("ios"), null, null, "daily", "all", null, null)))
                .contains(new PosterRules.Violation("cta_action",
                        "Value error, cta_action must be none, cloud_voice_enable, route or url", null));
        assertThat(PosterRules.validLocale(null)).isFalse();
        assertThat(PosterRules.validLocale("ko")).isTrue();
    }
}
