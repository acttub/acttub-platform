package com.acttub.actingapi.feature.poster.adapter.web;

import java.math.BigInteger;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.format.DateTimeParseException;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.poster.app.AppPoster;
import com.acttub.actingapi.feature.poster.domain.Poster;
import com.acttub.actingapi.feature.poster.domain.PosterDraft;
import com.acttub.actingapi.feature.poster.domain.PosterRules;
import com.acttub.actingapi.platform.web.ApiValidationException;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.PositiveOrZero;

final class PosterDtos {
    private PosterDtos() {
    }

    // ─── 앱 ─────────────────────────────────────────────────────────────

    @Schema(name = "AppPosterList", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    record AppPosterList(@Schema(requiredMode = Schema.RequiredMode.REQUIRED) List<AppPosterItem> posters) {
    }

    @Schema(name = "AppPoster", additionalProperties = Schema.AdditionalPropertiesValue.FALSE,
            description = "앱 첫 화면 공지 포스터 한 장. image_url 과 image_asset 은 많아야 하나가 차 있다.")
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record AppPosterItem(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "기기의 봤음·다시 보지 않기 저장 키")
            String slug,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "바뀌면 기기의 봤음·다시 보지 않기가 무효")
            int revision,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, allowableValues = {"daily", "once"}) String frequency,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, allowableValues = {"all", "cloud_voice_off"})
            String audience,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) boolean dismissible,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true) String badge,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String title,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true) String body,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true, description = "1시간 주소")
            String imageUrl,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true, description = "앱 번들 이미지 이름")
            String imageAsset,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true, description = "앱 번들 소리 이름")
            String audioAsset,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true) String ctaLabel,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED,
                    allowableValues = {"none", "cloud_voice_enable", "route", "url"}) String ctaAction,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true) String ctaTarget) {

        static AppPosterItem of(AppPoster poster) {
            return new AppPosterItem(poster.slug(), poster.revision(), poster.frequency(), poster.audience(),
                    poster.dismissible(), poster.badge(), poster.title(), poster.body(), poster.imageUrl(),
                    poster.imageAsset(), poster.audioAsset(), poster.ctaLabel(), poster.ctaAction(), poster.ctaTarget());
        }
    }

    // ─── 관리 ───────────────────────────────────────────────────────────

    @Schema(name = "AdminPosterList", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    record AdminPosterList(@Schema(requiredMode = Schema.RequiredMode.REQUIRED) List<AdminPoster> posters) {
    }

    @Schema(name = "AdminPoster", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record AdminPoster(UUID id, String slug, int revision, boolean active, int priority,
            @Schema(nullable = true) Instant startsAt, @Schema(nullable = true) Instant endsAt,
            List<String> platforms, @Schema(nullable = true) String locale,
            @Schema(nullable = true) String minAppVersion, String frequency, String audience, boolean dismissible,
            @Schema(nullable = true) String badge, String title, @Schema(nullable = true) String body,
            @Schema(nullable = true) String image, @Schema(nullable = true) String audio,
            @Schema(nullable = true) String ctaLabel, String ctaAction, @Schema(nullable = true) String ctaTarget,
            Instant createdAt, Instant updatedAt) {

        static AdminPoster of(Poster poster) {
            PosterDraft d = poster.draft();
            return new AdminPoster(poster.id(), d.slug(), poster.revision(), d.active(), d.priority(), d.startsAt(),
                    d.endsAt(), d.platforms(), d.locale(), d.minAppVersion(), d.frequency(), d.audience(),
                    d.dismissible(), d.badge(), d.title(), d.body(), d.image(), d.audio(), d.ctaLabel(),
                    d.ctaAction(), d.ctaTarget(), poster.createdAt(), poster.updatedAt());
        }
    }

    /**
     * 만들기 본문이자 고치기의 칸 목록. 빠진 칸은 기본값(꺼짐·우선순위 0·두 플랫폼·매일·모두·다시 보지 않기 보임·버튼
     * 없음)이다. 시각은 오프셋이 있는 ISO-8601 문자열이다.
     */
    @Schema(name = "AdminPosterFields", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record PosterFields(
            @NotNull String slug,
            Boolean active,
            Integer priority,
            @Schema(nullable = true, format = "date-time") String startsAt,
            @Schema(nullable = true, format = "date-time") String endsAt,
            List<String> platforms,
            @Schema(nullable = true) String locale,
            @Schema(nullable = true) String minAppVersion,
            @Schema(allowableValues = {"daily", "once"}) String frequency,
            @Schema(allowableValues = {"all", "cloud_voice_off"}) String audience,
            Boolean dismissible,
            @Schema(nullable = true) String badge,
            @NotNull String title,
            @Schema(nullable = true) String body,
            @Schema(nullable = true, description = "asset:<이름> 또는 posters/<uuid>.<png|jpg|webp>") String image,
            @Schema(nullable = true, description = "asset:<이름>") String audio,
            @Schema(nullable = true) String ctaLabel,
            @Schema(allowableValues = {"none", "cloud_voice_enable", "route", "url"}) String ctaAction,
            @Schema(nullable = true) String ctaTarget) {

        static PosterFields of(PosterDraft d) {
            return new PosterFields(d.slug(), d.active(), d.priority(), text(d.startsAt()), text(d.endsAt()),
                    d.platforms(), d.locale(), d.minAppVersion(), d.frequency(), d.audience(), d.dismissible(),
                    d.badge(), d.title(), d.body(), d.image(), d.audio(), d.ctaLabel(), d.ctaAction(), d.ctaTarget());
        }

        PosterDraft toDraft() {
            return new PosterDraft(slug, Boolean.TRUE.equals(active), priority == null ? 0 : priority,
                    instant("starts_at", startsAt), instant("ends_at", endsAt),
                    platforms == null ? PosterRules.DEFAULT_PLATFORMS : platforms, locale, minAppVersion,
                    frequency == null ? "daily" : frequency, audience == null ? "all" : audience,
                    dismissible == null || dismissible, badge, title, body, image, audio, ctaLabel,
                    ctaAction == null ? "none" : ctaAction, ctaTarget);
        }

        private static String text(Instant value) {
            return value == null ? null : value.toString();
        }

        private static Instant instant(String field, String value) {
            if (value == null) {
                return null;
            }
            try {
                return OffsetDateTime.parse(value).toInstant();
            } catch (DateTimeParseException invalid) {
                throw ApiValidationException.valueError(List.of("body", field),
                        "Value error, " + field + " must be an ISO-8601 date-time with offset", value);
            }
        }
    }

    @Schema(name = "AdminPosterImageRequest", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record ImageRequest(
            @NotNull @Schema(allowableValues = {"image/png", "image/jpeg", "image/webp"}) String contentType,
            @NotNull @PositiveOrZero @Schema(description = "올릴 파일의 바이트 수 — 서명에 들어가 정확해야 한다")
            BigInteger sizeBytes) {
    }

    @Schema(name = "AdminPosterImageUpload", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record ImageUpload(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "포스터 image 에 넣을 객체 키") String key,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "PUT 으로 올릴 주소") String uploadUrl,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) int expiresIn) {
    }
}
