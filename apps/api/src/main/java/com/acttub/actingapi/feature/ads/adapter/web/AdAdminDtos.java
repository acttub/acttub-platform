package com.acttub.actingapi.feature.ads.adapter.web;

import java.math.BigInteger;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.ads.domain.Ad;
import com.acttub.actingapi.feature.ads.domain.AdDraft;
import com.acttub.actingapi.feature.ads.domain.AdStats;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.PositiveOrZero;

final class AdAdminDtos {
    private AdAdminDtos() {
    }

    /** 등록·수정 본문의 모양. 보낸 칸만 바꾸고 null 은 비운다. */
    @Schema(name = "AdminAdFields", additionalProperties = Schema.AdditionalPropertiesValue.FALSE,
            description = "광고 값. kind 는 direct·house, status 는 active·paused·ended, audience 는 all·free·pro. "
                    + "image_* 는 /v2/admin/ad-images 가 준 key 또는 http(s) 주소.")
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record AdFields(
            String kind,
            String status,
            List<String> slots,
            String audience,
            Integer priority,
            @Schema(description = "우리 앱 광고(house)의 노출 비율 0~100 %. 비면 50. 나머지는 AdMob. direct 는 무시.")
            Integer sharePercent,
            String advertiserName,
            String headline,
            String body,
            String imageLargeBanner,
            String imageBanner,
            String imageMediumRectangle,
            String linkUrl,
            String appPath,
            Instant startsAt,
            Instant endsAt) {

        AdDraft toDraft() {
            return new AdDraft(kind, status, slots, audience, priority == null ? 0 : priority, advertiserName,
                    headline, body, imageLargeBanner, imageBanner, imageMediumRectangle, linkUrl, appPath, startsAt, endsAt,
                    Ad.HOUSE.equals(kind) && sharePercent != null ? sharePercent : AdDraft.DEFAULT_SHARE_PERCENT);
        }

        static AdFields of(AdDraft d) {
            return new AdFields(d.kind(), d.status(), d.slots(), d.audience(), d.priority(), d.sharePercent(),
                    d.advertiserName(), d.headline(), d.body(), d.imageLargeBanner(), d.imageBanner(), d.imageMediumRectangle(),
                    d.linkUrl(), d.appPath(), d.startsAt(), d.endsAt());
        }
    }

    @Schema(name = "AdminAdList", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    record AdminAdList(@Schema(requiredMode = Schema.RequiredMode.REQUIRED) List<AdminAd> ads) {
    }

    @Schema(name = "AdminAd", additionalProperties = Schema.AdditionalPropertiesValue.FALSE,
            description = "저장된 광고 한 건. image_*_url 은 미리보기용 1시간 주소. impressions 는 사람·광고·한국 날짜당 한 번으로 센 "
                    + "노출 수, clicks 는 누른 횟수 — 둘 다 만든 뒤 지금까지 합계.")
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record AdminAd(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) UUID id,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String kind,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String status,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) List<String> slots,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String audience,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) int priority,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "우리 앱 광고(house)의 노출 비율 0~100 %, 나머지는 AdMob. direct 는 쓰지 않는다(50).") int sharePercent,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true) String advertiserName,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true) String headline,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true) String body,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true) String imageLargeBanner,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true) String imageBanner,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true) String imageMediumRectangle,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true) String imageLargeBannerUrl,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true) String imageBannerUrl,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true) String imageMediumRectangleUrl,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true) String linkUrl,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true) String appPath,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true) Instant startsAt,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true) Instant endsAt,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) Instant createdAt,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) Instant updatedAt,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) long impressions,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) long clicks) {

        static AdminAd of(AdStats.Stored stored, java.util.function.Function<String, String> viewUrl) {
            AdDraft d = stored.draft();
            return new AdminAd(stored.id(), d.kind(), d.status(), d.slots(), d.audience(), d.priority(),
                    d.sharePercent(), d.advertiserName(), d.headline(), d.body(), d.imageLargeBanner(), d.imageBanner(),
                    d.imageMediumRectangle(), viewUrl.apply(d.imageLargeBanner()), viewUrl.apply(d.imageBanner()),
                    viewUrl.apply(d.imageMediumRectangle()), d.linkUrl(), d.appPath(), d.startsAt(), d.endsAt(),
                    stored.createdAt(), stored.updatedAt(), stored.impressions(), stored.clicks());
        }
    }

    @Schema(name = "AdminAdStats", additionalProperties = Schema.AdditionalPropertiesValue.FALSE,
            description = "from~to(양 끝 포함, 한국 날짜 YYYY-MM-DD) 날짜별 노출·클릭과 기간 합계. 기록 없는 날은 0.")
    record AdminAdStats(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "시작일 YYYY-MM-DD") String from,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "종료일 YYYY-MM-DD(포함)") String to,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) List<StatsDay> days,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "기간 노출 합계(사람·날짜당 한 번)") long impressions,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "기간 클릭 합계(누른 횟수)") long clicks) {

        static AdminAdStats of(AdStats.Period period) {
            return new AdminAdStats(period.from().toString(), period.to().toString(),
                    period.days().stream().map(day -> new StatsDay(day.day().toString(), day.impressions(), day.clicks())).toList(),
                    period.impressions(), period.clicks());
        }
    }

    @Schema(name = "AdminAdStatsDay", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    record StatsDay(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "한국 날짜 YYYY-MM-DD") String day,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) long impressions,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) long clicks) {
    }

    @Schema(name = "AdminAdImageRequest", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record ImageRequest(
            @NotNull @Schema(allowableValues = {"LARGE_BANNER", "BANNER", "MEDIUM_RECTANGLE"},
                    description = "칸 규격: 320x100·320x50·300x250") String size,
            @NotNull @PositiveOrZero @Schema(description = "읽어 둔 이미지 가로(px) — 규격 또는 2~4배여야 한다") Integer width,
            @NotNull @PositiveOrZero @Schema(description = "읽어 둔 이미지 세로(px)") Integer height,
            @NotNull @Schema(allowableValues = {"image/png", "image/jpeg", "image/webp"}) String contentType,
            @NotNull @PositiveOrZero @Schema(description = "올릴 파일의 바이트 수(2MB까지) — 서명에 들어가 정확해야 한다")
            BigInteger sizeBytes) {
    }

    @Schema(name = "AdminAdImageUpload", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record ImageUpload(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "광고 image_* 에 넣을 객체 키") String key,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "PUT 으로 올릴 주소") String uploadUrl,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) int expiresIn) {
    }
}
