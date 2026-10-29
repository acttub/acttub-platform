package com.acttub.actingapi.feature.ads.adapter.web;

import java.util.UUID;

import com.acttub.actingapi.feature.ads.app.AdImages;
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

        static AdSlotPick of(AdPicker.Pick pick, AdImages images) {
            var size = pick.slot().size();
            return new AdSlotPick(pick.kind().name(), pick.slot().key(), size.name(), size.width(), size.height(),
                    pick.ad() == null ? null : AdCreative.of(pick.ad(), pick.slot().size(), images));
        }
    }

    @Schema(name = "AdCreative", additionalProperties = Schema.AdditionalPropertiesValue.FALSE,
            description = "직접·자체 광고 한 건. DIRECT 는 image_url·link_url 이 늘 있고 누르면 link_url 을 앱 밖 브라우저로 연다. HOUSE 는 app_path 로 간다.")
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record AdCreative(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) UUID id,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true, description = "칸 규격의 이미지")
            String imageUrl,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true) String headline,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true) String body,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true, description = "HOUSE 의 앱 안 경로")
            String appPath,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true) String advertiserName,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true, description = "DIRECT 의 광고주 링크(http/https)")
            String linkUrl) {

        static AdCreative of(Ad ad, com.acttub.actingapi.feature.ads.domain.AdSize size, AdImages images) {
            return new AdCreative(ad.id(), images.urlFor(ad.imageFor(size)), ad.headline(), ad.body(),
                    Ad.HOUSE.equals(ad.kind()) ? ad.appPath() : null, ad.advertiserName(),
                    Ad.DIRECT.equals(ad.kind()) ? ad.linkUrl() : null);
        }
    }

    @Schema(name = "AdEventRequest", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    record AdEventRequest(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "광고가 보인 칸 키") String slot,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, allowableValues = {"impression", "click"}) String event) {
    }
}
