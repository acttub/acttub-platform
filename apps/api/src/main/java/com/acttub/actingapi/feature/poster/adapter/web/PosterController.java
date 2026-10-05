package com.acttub.actingapi.feature.poster.adapter.web;

import java.util.List;

import com.acttub.actingapi.feature.poster.adapter.web.PosterDtos.AppPosterItem;
import com.acttub.actingapi.feature.poster.adapter.web.PosterDtos.AppPosterList;
import com.acttub.actingapi.feature.poster.app.PosterService;
import com.acttub.actingapi.feature.poster.domain.PosterRules;
import com.acttub.actingapi.platform.security.AccessGate;
import com.acttub.actingapi.platform.web.ApiValidationException;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** 앱 첫 화면 공지 포스터(app.poster). 회원·게스트 모두 받는다 — 무엇을 띄울지 마지막 판정은 앱이 한다. */
@RestController
@RequestMapping("/v2/app")
class PosterController {
    private final PosterService posters;
    private final AccessGate auth;

    PosterController(PosterService posters, AccessGate auth) {
        this.posters = posters;
        this.auth = auth;
    }

    @Operation(
            summary = "List App Posters",
            description = """
                    지금 앱 첫 화면에 띄울 수 있는 공지 포스터를 우선순위 큰 것, 최근에 고친 것 순으로 최대 5장.
                    켜져 있고 기간 안이며 플랫폼이 맞고 언어가 없거나 같은 것만 낸다. min_app_version 이 있는 포스터는
                    app_version 이 그 이상일 때만 낸다(app_version 을 보내지 않으면 빠진다). 빈도·다시 보지 않기·
                    대상(audience)의 판정은 앱이 기기 상태로 한다.""",
            operationId = "list_posters_v2_app_posters_get",
            tags = "v2-app",
            security = @SecurityRequirement(name = "HTTPBearer"))
    @ApiResponses({
        @ApiResponse(
                responseCode = "200",
                description = "Successful Response",
                content = @Content(schema = @Schema(implementation = AppPosterList.class))),
        @ApiResponse(
                responseCode = "422",
                description = "Validation Error",
                content = @Content(schema = @Schema(ref = "#/components/schemas/HTTPValidationError")))
    })
    @GetMapping("/posters")
    AppPosterList list(
            @Parameter(required = true, schema = @Schema(type = "string", allowableValues = {"ios", "android"}))
            @RequestParam(name = "platform", required = false) String platform,
            @Parameter(description = "앱 표시 언어(두 글자). 없으면 언어 없는 포스터만", schema = @Schema(type = "string"))
            @RequestParam(name = "locale", required = false) String locale,
            @Parameter(description = "앱 판(점으로 이은 숫자)", schema = @Schema(type = "string"))
            @RequestParam(name = "app_version", required = false) String appVersion,
            HttpServletRequest request) {
        auth.gatedUser(request);
        if (platform == null) {
            throw ApiValidationException.missing(List.of("query", "platform"), null);
        }
        if (!PosterRules.PLATFORMS.contains(platform)) {
            throw ApiValidationException.valueError(List.of("query", "platform"),
                    "Value error, platform must be ios or android", platform);
        }
        if (locale != null && !PosterRules.validLocale(locale)) {
            throw ApiValidationException.valueError(List.of("query", "locale"),
                    "Value error, locale must be a two-letter language code", locale);
        }
        if (appVersion != null && !PosterRules.validVersion(appVersion)) {
            throw ApiValidationException.valueError(List.of("query", "app_version"),
                    "Value error, app_version must be dot-separated numbers", appVersion);
        }
        return new AppPosterList(posters.forApp(platform, locale, appVersion).stream()
                .map(AppPosterItem::of)
                .toList());
    }
}
