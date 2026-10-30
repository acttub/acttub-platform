package com.acttub.actingapi.feature.ads.adapter.web;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Clock;
import java.util.List;
import java.util.Map;
import java.util.Set;

import com.acttub.actingapi.feature.admin.app.AdminService;
import com.acttub.actingapi.feature.ads.app.AdFrequency;
import com.acttub.actingapi.platform.web.ApiException;
import com.acttub.actingapi.platform.web.ApiValidationException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.swagger.v3.oas.annotations.Operation;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnExpression;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 광고 빈도 상한 운영 경로(SOMA-876) — 광고 관리 웹이 "N분에 M개, 가입 첫날 K개"를 보고 바꾼다.
 * {@code ADMIN_OPS_TOKEN} 을 Bearer 로 받고, 토큰이 없는 기동에는 통째로 없다.
 */
@RestController
@RequestMapping("/v2/admin")
@ConditionalOnExpression(AdminService.ENABLED_WHEN)
class AdSettingsAdminController {
    private static final Set<String> FIELDS = Set.of("window_minutes", "window_cap", "first_day_cap");

    private final AdFrequency frequency;
    private final Clock clock;
    private final ObjectMapper mapper;
    private final byte[] expectedAuthorization;

    AdSettingsAdminController(AdFrequency frequency, Clock clock, ObjectMapper mapper,
            @Value("${ADMIN_OPS_TOKEN}") String adminToken) {
        this.frequency = frequency;
        this.clock = clock;
        this.mapper = mapper;
        this.expectedAuthorization = ("Bearer " + adminToken).getBytes(StandardCharsets.UTF_8);
    }

    @Operation(summary = "Get Ad Settings", operationId = "get_ad_settings_v2_admin_ad_settings_get", tags = "admin",
            description = "광고 빈도 상한. window_minutes 분 동안 사람마다 window_cap 개까지, 가입 24시간 이내는 first_day_cap 개까지.")
    @GetMapping("/ad-settings")
    ResponseEntity<Map<String, Integer>> get(@RequestHeader(name = "authorization", defaultValue = "") String authorization) {
        requireToken(authorization);
        return ok(frequency.limits());
    }

    @Operation(summary = "Update Ad Settings", operationId = "update_ad_settings_v2_admin_ad_settings_put", tags = "admin",
            description = "보낸 값만 바꾼다. window_minutes 1~1440, window_cap·first_day_cap 0~100 의 정수. 아니면 422.")
    @PutMapping("/ad-settings")
    ResponseEntity<Map<String, Integer>> put(
            @RequestBody JsonNode body, @RequestHeader(name = "authorization", defaultValue = "") String authorization) {
        requireToken(authorization);
        if (!body.isObject()) {
            throw ApiValidationException.valueError(List.<Object>of("body"), "Value error, body must be an object",
                    mapper.convertValue(body, Object.class));
        }
        body.fieldNames().forEachRemaining(name -> {
            if (!FIELDS.contains(name)) {
                throw ApiValidationException.valueError(List.<Object>of("body", name),
                        "Value error, unknown field", mapper.convertValue(body.get(name), Object.class));
            }
        });
        AdFrequency.Limits current = frequency.limits();
        AdFrequency.Limits next = new AdFrequency.Limits(
                integer(body, "window_minutes", current.windowMinutes(), 1, AdFrequency.Limits.MAX_WINDOW_MINUTES),
                integer(body, "window_cap", current.windowCap(), 0, AdFrequency.Limits.MAX_CAP),
                integer(body, "first_day_cap", current.firstDayCap(), 0, AdFrequency.Limits.MAX_CAP));
        return ok(frequency.update(next, clock.instant()));
    }

    private int integer(JsonNode body, String name, int fallback, int min, int max) {
        JsonNode value = body.get(name);
        if (value == null) {
            return fallback;
        }
        if (!value.isIntegralNumber() || !value.canConvertToInt() || value.intValue() < min || value.intValue() > max) {
            throw ApiValidationException.valueError(List.<Object>of("body", name),
                    "Value error, " + name + " must be an integer from " + min + " to " + max,
                    mapper.convertValue(value, Object.class));
        }
        return value.intValue();
    }

    private static ResponseEntity<Map<String, Integer>> ok(AdFrequency.Limits limits) {
        return ResponseEntity.ok().header(HttpHeaders.CACHE_CONTROL, "private, no-store").body(Map.of(
                "window_minutes", limits.windowMinutes(),
                "window_cap", limits.windowCap(),
                "first_day_cap", limits.firstDayCap()));
    }

    private void requireToken(String authorization) {
        byte[] actual = authorization.getBytes(StandardCharsets.UTF_8);
        if (!MessageDigest.isEqual(actual, expectedAuthorization)) {
            throw new ApiException(401, "Unauthorized");
        }
    }
}
