package com.acttub.actingapi.feature.ads.adapter.web;

import java.util.List;
import java.util.Locale;
import java.util.UUID;

import com.acttub.actingapi.feature.ads.adapter.web.AdDtos.AdEventRequest;
import com.acttub.actingapi.feature.ads.adapter.web.AdDtos.AdSlotPick;
import com.acttub.actingapi.feature.ads.app.AdImages;
import com.acttub.actingapi.feature.ads.app.AdService;
import com.acttub.actingapi.feature.ads.domain.AdSlot;
import com.acttub.actingapi.platform.security.AccessGate;
import com.acttub.actingapi.platform.web.ApiException;
import com.acttub.actingapi.platform.web.ApiValidationException;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** 앱 광고 칸(app.ads, SOMA-876). 다른 v2 경로와 같은 문(동의·프로필)을 거친다 — 게스트는 지원 기능이 아니라 403 이고 앱은 칸을 비운다. */
@RestController
@RequestMapping("/v2/ads")
class AdController {
    private final AdService ads;
    private final AccessGate auth;
    private final AdImages images;

    AdController(AdService ads, AccessGate auth, AdImages images) {
        this.ads = ads;
        this.auth = auth;
        this.images = images;
    }

    @Operation(
            summary = "Pick Ad For Slot",
            description = """
                    칸 하나에 띄울 광고를 고른다. 광고주 직접 광고(DIRECT) → 우리 앱 광고(HOUSE) → AdMob(NETWORK) 순이고,
                    첫 연습을 끝내기 전이면 NONE 이다. 연습 중 칸은 Pro 면 NONE, 무료면 A/B 로 켠 사람만 받는다.""",
            operationId = "pick_ad_v2_ads_get",
            tags = "v2-ads",
            security = @SecurityRequirement(name = "HTTPBearer"))
    @ApiResponses({
        @ApiResponse(
                responseCode = "200",
                description = "Successful Response",
                content = @Content(schema = @Schema(implementation = AdSlotPick.class))),
        @ApiResponse(
                responseCode = "422",
                description = "Validation Error",
                content = @Content(schema = @Schema(ref = "#/components/schemas/HTTPValidationError")))
    })
    @GetMapping
    AdSlotPick pick(
            @Parameter(required = true, description = "칸 키(예: home_top)", schema = @Schema(type = "string"))
            @RequestParam(name = "slot", required = false) String slot,
            HttpServletRequest request) {
        UUID userId = auth.gatedUser(request).id();
        return AdSlotPick.of(ads.pick(userId, slotOf(slot, List.<Object>of("query", "slot"))), images);
    }

    @Operation(
            summary = "Record Ad Event",
            description = """
                    직접·자체 광고의 노출(impression)·클릭(click)을 남긴다. 노출은 한 사람·광고·한국 날짜에 한 번만 남고,
                    클릭은 누를 때마다 남는다. 없는 광고는 404 ad_not_found.""",
            operationId = "record_ad_event_v2_ads__ad_id__events_post",
            tags = "v2-ads",
            security = @SecurityRequirement(name = "HTTPBearer"))
    @ApiResponses({
        @ApiResponse(responseCode = "204", description = "Successful Response"),
        @ApiResponse(
                responseCode = "422",
                description = "Validation Error",
                content = @Content(schema = @Schema(ref = "#/components/schemas/HTTPValidationError")))
    })
    @PostMapping("/{ad_id}/events")
    ResponseEntity<Void> record(
            @PathVariable("ad_id") UUID adId, @RequestBody AdEventRequest body, HttpServletRequest request) {
        UUID userId = auth.gatedUser(request).id();
        AdSlot slot = slotOf(body.slot(), List.<Object>of("body", "slot"));
        AdService.Event event = eventOf(body.event());
        if (!ads.record(userId, adId, slot, event)) {
            throw new ApiException(404, "ad_not_found");
        }
        return ResponseEntity.noContent().build();
    }

    private static AdSlot slotOf(String key, List<Object> loc) {
        if (key == null) {
            throw ApiValidationException.missing(loc, null);
        }
        return AdSlot.of(key).orElseThrow(() -> ApiValidationException.valueError(loc, "Value error, unknown ad slot", key));
    }

    private static AdService.Event eventOf(String event) {
        if (event == null) {
            throw ApiValidationException.missing(List.<Object>of("body", "event"), null);
        }
        return switch (event.toLowerCase(Locale.ROOT)) {
            case "impression" -> AdService.Event.IMPRESSION;
            case "click" -> AdService.Event.CLICK;
            default -> throw ApiValidationException.valueError(
                    List.<Object>of("body", "event"), "Value error, event must be impression or click", event);
        };
    }
}
