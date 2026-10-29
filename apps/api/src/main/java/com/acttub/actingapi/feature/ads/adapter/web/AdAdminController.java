package com.acttub.actingapi.feature.ads.adapter.web;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.Arrays;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.function.UnaryOperator;
import java.util.stream.Collectors;

import com.acttub.actingapi.feature.admin.app.AdminService;
import com.acttub.actingapi.feature.ads.adapter.web.AdAdminDtos.AdFields;
import com.acttub.actingapi.feature.ads.adapter.web.AdAdminDtos.AdminAd;
import com.acttub.actingapi.feature.ads.adapter.web.AdAdminDtos.AdminAdList;
import com.acttub.actingapi.feature.ads.adapter.web.AdAdminDtos.AdminAdStats;
import com.acttub.actingapi.feature.ads.adapter.web.AdAdminDtos.ImageRequest;
import com.acttub.actingapi.feature.ads.adapter.web.AdAdminDtos.ImageUpload;
import com.acttub.actingapi.feature.ads.app.AdAdminService;
import com.acttub.actingapi.feature.ads.domain.AdDraft;
import com.acttub.actingapi.feature.ads.domain.AdSize;
import com.acttub.actingapi.platform.web.ApiException;
import com.acttub.actingapi.platform.web.ApiValidationException;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonMappingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.node.ObjectNode;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import jakarta.validation.Valid;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnExpression;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * 광고 운영 경로(app.ads, SOMA-876). 포스터와 같이 {@code ADMIN_OPS_TOKEN} 을 Bearer 로 받고, 토큰이 없는 기동에는
 * 통째로 없다. 지우기는 없다 — 끄는 것은 {@code status} 다.
 */
@RestController
@RequestMapping("/v2/admin")
@ConditionalOnExpression(AdminService.ENABLED_WHEN)
class AdAdminController {
    private final AdAdminService ads;
    private final ObjectMapper mapper;
    private final byte[] expectedAuthorization;
    private final Set<String> fields;

    AdAdminController(AdAdminService ads, ObjectMapper mapper, @Value("${ADMIN_OPS_TOKEN}") String adminToken) {
        this.ads = ads;
        this.mapper = mapper;
        this.expectedAuthorization = ("Bearer " + adminToken).getBytes(StandardCharsets.UTF_8);
        var snakeCase = new PropertyNamingStrategies.SnakeCaseStrategy();
        this.fields = Arrays.stream(AdFields.class.getRecordComponents())
                .map(component -> snakeCase.translate(component.getName()))
                .collect(Collectors.toUnmodifiableSet());
    }

    @Operation(summary = "List Ads", operationId = "list_ads_v2_admin_ads_get", tags = "admin",
            description = "꺼진 것·끝난 것까지 전부, 지금까지 노출·클릭 합계와 함께. 켜진 것, 우선순위 큰 것, 최근 것 순.")
    @ApiResponse(responseCode = "200", description = "Successful Response",
            content = @Content(schema = @Schema(implementation = AdminAdList.class)))
    @GetMapping("/ads")
    ResponseEntity<AdminAdList> list(@RequestHeader(name = "authorization", defaultValue = "") String authorization) {
        requireToken(authorization);
        return ok(new AdminAdList(ads.all().stream().map(stored -> AdminAd.of(stored, ads::viewUrl)).toList()));
    }

    @Operation(summary = "Create Ad", operationId = "create_ad_v2_admin_ads_post", tags = "admin",
            description = """
                    광고를 만든다(기본 direct·active). direct 는 advertiser_name, http(s) link_url, 붙인 칸마다 그 칸 규격
                    이미지가 있어야 하고, house 는 /로 시작하는 app_path 와 이미지 또는 headline 이 있어야 한다. 아니면 422.""")
    @ApiResponse(responseCode = "201", description = "Created",
            content = @Content(schema = @Schema(implementation = AdminAd.class)))
    @PostMapping("/ads")
    ResponseEntity<AdminAd> create(
            @RequestBody JsonNode body, @RequestHeader(name = "authorization", defaultValue = "") String authorization) {
        requireToken(authorization);
        AdDraft draft = merge(AdDraft.blank(), changes(body));
        return ResponseEntity.status(201).header(HttpHeaders.CACHE_CONTROL, "private, no-store")
                .body(AdminAd.of(ads.create(draft), ads::viewUrl));
    }

    @Operation(summary = "Update Ad", operationId = "update_ad_v2_admin_ads__id__patch", tags = "admin",
            description = "보낸 칸만 바꾼다(null 을 보내면 비운다). status 로 켜기(active)·멈추기(paused)·종료(ended). 없으면 404 ad_not_found.")
    @ApiResponse(responseCode = "200", description = "Successful Response",
            content = @Content(schema = @Schema(implementation = AdminAd.class)))
    @PatchMapping("/ads/{id}")
    ResponseEntity<AdminAd> update(
            @PathVariable UUID id,
            @RequestBody JsonNode body,
            @RequestHeader(name = "authorization", defaultValue = "") String authorization) {
        requireToken(authorization);
        ObjectNode changes = changes(body);
        UnaryOperator<AdDraft> change = current -> merge(current, changes);
        return ok(AdminAd.of(ads.update(id, change), ads::viewUrl));
    }

    @Operation(summary = "Get Ad Stats", operationId = "get_ad_stats_v2_admin_ads__id__stats_get", tags = "admin",
            description = """
                    날짜별 노출·클릭과 기간 합계. from·to 는 한국 날짜 YYYY-MM-DD(양 끝 포함), 비우면 오늘까지 30일, 최대 366일.
                    노출은 한 사람·광고·날짜에 한 번, 클릭은 누른 횟수다.""")
    @ApiResponse(responseCode = "200", description = "Successful Response",
            content = @Content(schema = @Schema(implementation = AdminAdStats.class)))
    @GetMapping("/ads/{id}/stats")
    ResponseEntity<AdminAdStats> stats(
            @PathVariable UUID id,
            @RequestParam(name = "from", required = false) String from,
            @RequestParam(name = "to", required = false) String to,
            @RequestHeader(name = "authorization", defaultValue = "") String authorization) {
        requireToken(authorization);
        return ok(AdminAdStats.of(ads.stats(id, date("from", from), date("to", to))));
    }

    @Operation(summary = "Create Ad Image Upload", operationId = "create_ad_image_v2_admin_ad_images_post",
            tags = "admin", description = """
                    광고 이미지를 올릴 10분짜리 PUT 주소와 객체 키. size(LARGE_BANNER 320x100·BANNER 320x50·MEDIUM_RECTANGLE 300x250)
                    와 읽어 둔 width·height 를 보낸다(규격 또는 2~4배, 아니면 422). 같은 Content-Type 과 size_bytes 로 PUT 한
                    뒤 key 를 그 규격 image_* 에 넣는다. PNG·JPEG·WebP 만(아니면 415), 2MB 까지(넘으면 413).""")
    @ApiResponse(responseCode = "200", description = "Successful Response",
            content = @Content(schema = @Schema(implementation = ImageUpload.class)))
    @PostMapping("/ad-images")
    ResponseEntity<ImageUpload> imageUpload(
            @Valid @RequestBody ImageRequest body,
            @RequestHeader(name = "authorization", defaultValue = "") String authorization) {
        requireToken(authorization);
        AdSize size;
        try {
            size = AdSize.valueOf(body.size());
        } catch (IllegalArgumentException unknown) {
            throw ApiValidationException.valueError(List.<Object>of("body", "size"),
                    "Value error, size must be LARGE_BANNER, BANNER or MEDIUM_RECTANGLE", body.size());
        }
        AdAdminService.ImageUpload upload = ads.beginImageUpload(size, body.width(), body.height(), body.contentType(),
                body.sizeBytes());
        return ok(new ImageUpload(upload.key(), upload.uploadUrl(), upload.expiresIn()));
    }

    private ObjectNode changes(JsonNode body) {
        if (!(body instanceof ObjectNode patch)) {
            throw ApiValidationException.valueError(List.<Object>of("body"), "Value error, body must be an object",
                    mapper.convertValue(body, Object.class));
        }
        ObjectNode changes = patch.deepCopy();
        for (Iterator<String> names = changes.fieldNames(); names.hasNext(); ) {
            String name = names.next();
            if (!fields.contains(name)) {
                Map<String, Object> error = new LinkedHashMap<>();
                error.put("type", "extra_forbidden");
                error.put("loc", List.of("body", name));
                error.put("msg", "Extra inputs are not permitted");
                error.put("input", mapper.convertValue(changes.get(name), Object.class));
                throw new ApiValidationException(List.of(error));
            }
        }
        return changes;
    }

    /** 지금 값 위에 보낸 칸을 얹는다. 칸의 형태가 틀리면 그 칸을 가리키는 422 다. */
    private AdDraft merge(AdDraft current, ObjectNode changes) {
        ObjectNode merged = mapper.valueToTree(AdFields.of(current));
        merged.setAll(changes);
        try {
            return mapper.treeToValue(merged, AdFields.class).toDraft();
        } catch (JsonMappingException invalid) {
            String field = invalid.getPath().isEmpty() ? null : invalid.getPath().getFirst().getFieldName();
            throw ApiValidationException.valueError(
                    field == null ? List.<Object>of("body") : List.<Object>of("body", field),
                    "Value error, invalid value", field == null ? null : mapper.convertValue(changes.get(field), Object.class));
        } catch (JsonProcessingException invalid) {
            throw ApiValidationException.valueError(List.<Object>of("body"), "Value error, invalid body", null);
        }
    }

    private static LocalDate date(String name, String value) {
        if (value == null || value.isBlank()) {
            return null;
        }
        try {
            return LocalDate.parse(value);
        } catch (DateTimeParseException invalid) {
            throw ApiValidationException.valueError(List.<Object>of("query", name),
                    "Value error, " + name + " must be YYYY-MM-DD", value);
        }
    }

    private static <T> ResponseEntity<T> ok(T body) {
        return ResponseEntity.ok().header(HttpHeaders.CACHE_CONTROL, "private, no-store").body(body);
    }

    private void requireToken(String authorization) {
        byte[] actual = authorization.getBytes(StandardCharsets.UTF_8);
        if (!MessageDigest.isEqual(actual, expectedAuthorization)) {
            throw new ApiException(401, "Unauthorized");
        }
    }
}
