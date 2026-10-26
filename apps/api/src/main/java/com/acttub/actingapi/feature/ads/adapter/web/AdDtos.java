package com.acttub.actingapi.feature.ads.adapter.web;

import java.util.UUID;

import com.acttub.actingapi.feature.ads.domain.Ad;
import com.acttub.actingapi.feature.ads.domain.AdPicker;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import io.swagger.v3.oas.annotations.media.Schema;

final class AdDtos {
    private AdDtos() {
    }

    @Schema(name = "AdSlotPick", additionalProperties = Schema.AdditionalPropertiesValue.FALSE,
            description = "칸 하나에 띄울 것. kind 가 DIRECT·HOUSE 일 때만 ad 가 있다. NETWORK 면 앱이 AdMob 으로 채우고, NONE 이면 칸을 비운다.")
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record AdSlotPick(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, allowableValues = {"DIRECT", "HOUSE", "NETWORK", "NONE"})
            String kind,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String slot,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED,
                    allowableValues = {"LARGE_BANNER", "BANNER", "MEDIUM_RECTANGLE"}) String size,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) int width,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) int height,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true) AdCreative ad) {

        static AdSlotPick of(AdPicker.Pick pick) {
            var size = pick.slot().size();
            return new AdSlotPick(pick.kind().name(), pick.slot().key(), size.name(), size.width(), size.height(),
                    pick.ad() == null ? null : AdCreative.of(pick.ad(), pick.slot().size()));
        }
    }

    @Schema(name = "AdCreative", additionalProperties = Schema.AdditionalPropertiesValue.FALSE,
            description = "직접·자체 광고 한 건. DIRECT 는 image_url 이 늘 있고 누르면 광고 상세 화면으로, HOUSE 는 app_path 로 간다.")
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record AdCreative(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) UUID id,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true, description = "칸 규격의 이미지")
            String imageUrl,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true) String headline,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true) String body,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true, description = "HOUSE 의 앱 안 경로")
            String appPath,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true) String advertiserName) {

        static AdCreative of(Ad ad, com.acttub.actingapi.feature.ads.domain.AdSize size) {
            return new AdCreative(ad.id(), ad.imageFor(size), ad.headline(), ad.body(),
                    Ad.HOUSE.equals(ad.kind()) ? ad.appPath() : null, ad.advertiserName());
        }
    }

    @Schema(name = "AdDetail", additionalProperties = Schema.AdditionalPropertiesValue.FALSE,
            description = "학원 직접 광고의 상세 화면 정보. 학원 정보는 광고주가 낸 그대로 보인다.")
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record AdDetail(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) UUID id,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true) String advertiserName,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true, description = "학원 등록번호")
            String academyRegistrationNo,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true, description = "교습과정")
            String courseName,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true, description = "교습비(추가 경비 포함)")
            String tuition,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true) String headline,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true) String body,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true, description = "큰 이미지(300x250 → 320x100 → 320x50 순)")
            String imageUrl,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true, description = "외부 링크")
            String linkUrl) {

        static AdDetail of(Ad ad) {
            String image = ad.imageMediumRectangle() != null ? ad.imageMediumRectangle()
                    : ad.imageLargeBanner() != null ? ad.imageLargeBanner() : ad.imageBanner();
            return new AdDetail(ad.id(), ad.advertiserName(), ad.academyRegistrationNo(), ad.courseName(), ad.tuition(),
                    ad.headline(), ad.body(), image, ad.linkUrl());
        }
    }

    @Schema(name = "AdEventRequest", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    record AdEventRequest(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "광고가 보인 칸 키") String slot,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, allowableValues = {"impression", "click"}) String event) {
    }
}
