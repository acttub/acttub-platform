package com.acttub.actingapi.feature.poster.adapter.web;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import java.util.function.UnaryOperator;

import com.acttub.actingapi.feature.admin.app.AdminService;
import com.acttub.actingapi.feature.poster.adapter.web.PosterDtos.AdminPoster;
import com.acttub.actingapi.feature.poster.adapter.web.PosterDtos.AdminPosterList;
import com.acttub.actingapi.feature.poster.adapter.web.PosterDtos.ImageRequest;
import com.acttub.actingapi.feature.poster.adapter.web.PosterDtos.ImageUpload;
import com.acttub.actingapi.feature.poster.adapter.web.PosterDtos.PosterFields;
import com.acttub.actingapi.feature.poster.app.PosterService;
import com.acttub.actingapi.feature.poster.domain.PosterDraft;
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
import org.springframework.web.bind.annotation.RestController;

/**
 * 공지 포스터의 운영 경로(app.poster). 다른 {@code /v2/admin} 과 같이 {@code ADMIN_OPS_TOKEN} 을 Bearer 로 받고, 토큰을
 * 주지 않은 기동에는 통째로 없다({@link AdminService#ENABLED_WHEN}). 지우기는 없다 — 끄는 것은 {@code active=false} 다.
 */
@RestController
@RequestMapping("/v2/admin")
@ConditionalOnExpression(AdminService.ENABLED_WHEN)
class PosterAdminController {
    private static final String BUMP_REVISION = "bump_revision";

    private final PosterService posters;
    private final ObjectMapper mapper;
    private final byte[] expectedAuthorization;
    private final Set<String> patchableFields;

    PosterAdminController(PosterService posters, ObjectMapper mapper, @Value("${ADMIN_OPS_TOKEN}") String adminToken) {
        this.posters = posters;
        this.mapper = mapper;
        this.expectedAuthorization = ("Bearer " + adminToken).getBytes(StandardCharsets.UTF_8);
        var snakeCase = new PropertyNamingStrategies.SnakeCaseStrategy();
        this.patchableFields = Arrays.stream(PosterFields.class.getRecordComponents())
                .map(component -> snakeCase.translate(component.getName()))
                .collect(Collectors.toUnmodifiableSet());
    }

    @Operation(summary = "List Posters", operationId = "list_posters_v2_admin_posters_get", tags = "admin",
            description = "꺼진 것까지 전부, 저장된 값 그대로. 켜진 것, 우선순위 큰 것, 최근에 고친 것 순.")
    @ApiResponse(responseCode = "200", description = "Successful Response",
            content = @Content(schema = @Schema(implementation = AdminPosterList.class)))
    @GetMapping("/posters")
    ResponseEntity<AdminPosterList> list(@RequestHeader(name = "authorization", defaultValue = "") String authorization) {
        requireToken(authorization);
        return privateNoStore(new AdminPosterList(posters.all().stream().map(AdminPoster::of).toList()));
    }

    @Operation(summary = "Create Poster", operationId = "create_poster_v2_admin_posters_post", tags = "admin",
            description = "같은 (slug, locale) 이 있으면 422 duplicate_poster. 빠진 칸은 기본값이고 꺼진 채로 만들 수 있다.")
    @ApiResponse(responseCode = "201", description = "Created",
            content = @Content(schema = @Schema(implementation = AdminPoster.class)))
    @PostMapping("/posters")
    ResponseEntity<AdminPoster> create(
            @Valid @RequestBody PosterFields body,
            @RequestHeader(name = "authorization", defaultValue = "") String authorization) {
        requireToken(authorization);
        return ResponseEntity.status(201).header(HttpHeaders.CACHE_CONTROL, "private, no-store")
                .body(AdminPoster.of(posters.create(body.toDraft())));
    }

    @Operation(summary = "Update Poster", operationId = "update_poster_v2_admin_posters__id__patch", tags = "admin",
            description = """
                    보낸 칸만 바꾼다(null 을 보내면 비운다). bump_revision=true 면 revision 을 하나 올려 기기에 남은
                    봤음·다시 보지 않기를 무효로 한다. 없으면 404 poster_not_found.""")
    @ApiResponse(responseCode = "200", description = "Successful Response",
            content = @Content(schema = @Schema(implementation = AdminPoster.class)))
    @PatchMapping("/posters/{id}")
    ResponseEntity<AdminPoster> update(
            @PathVariable UUID id,
            @RequestBody JsonNode body,
            @RequestHeader(name = "authorization", defaultValue = "") String authorization) {
        requireToken(authorization);
        if (!(body instanceof ObjectNode patch)) {
            throw ApiValidationException.valueError(List.of("body"), "Value error, body must be an object",
                    mapper.convertValue(body, Object.class));
        }
        ObjectNode changes = patch.deepCopy();
        JsonNode bump = changes.remove(BUMP_REVISION);
        if (bump != null && !bump.isBoolean()) {
            throw ApiValidationException.valueError(List.of("body", BUMP_REVISION),
                    "Value error, bump_revision must be a boolean", mapper.convertValue(bump, Object.class));
        }
        for (Iterator<String> names = changes.fieldNames(); names.hasNext(); ) {
            String name = names.next();
            if (!patchableFields.contains(name)) {
                throw extraForbidden(name, changes.get(name));
            }
        }
        boolean bumpRevision = bump != null && bump.booleanValue();
        return privateNoStore(AdminPoster.of(posters.update(id, merge(changes), bumpRevision)));
    }

    @Operation(summary = "Create Poster Image Upload", operationId = "create_poster_image_v2_admin_poster_images_post",
            tags = "admin", description = """
                    포스터 이미지를 올릴 10분짜리 PUT 주소와 객체 키. 같은 Content-Type 과 size_bytes 바이트로 PUT 한 뒤
                    key 를 포스터의 image 에 넣는다. PNG·JPEG·WebP 만(아니면 415), 10MB 까지(넘으면 413).""")
    @ApiResponse(responseCode = "200", description = "Successful Response",
            content = @Content(schema = @Schema(implementation = ImageUpload.class)))
    @PostMapping("/poster-images")
    ResponseEntity<ImageUpload> imageUpload(
            @Valid @RequestBody ImageRequest body,
            @RequestHeader(name = "authorization", defaultValue = "") String authorization) {
        requireToken(authorization);
        PosterService.ImageUpload upload = posters.beginImageUpload(body.contentType(), body.sizeBytes());
        return privateNoStore(new ImageUpload(upload.key(), upload.uploadUrl(), upload.expiresIn()));
    }

    /** 지금 값 위에 보낸 칸을 얹는다. 칸의 형태가 틀리면 그 칸을 가리키는 422 다. */
    private UnaryOperator<PosterDraft> merge(ObjectNode changes) {
        return current -> {
            ObjectNode merged = mapper.valueToTree(PosterFields.of(current));
            merged.setAll(changes);
            try {
                return mapper.treeToValue(merged, PosterFields.class).toDraft();
            } catch (JsonMappingException invalid) {
                String field = invalid.getPath().isEmpty() ? null : invalid.getPath().getFirst().getFieldName();
                throw ApiValidationException.valueError(field == null ? List.<Object>of("body") : List.<Object>of("body", field),
                        "Value error, invalid value",
                        field == null ? null : mapper.convertValue(changes.get(field), Object.class));
            } catch (JsonProcessingException invalid) {
                throw ApiValidationException.valueError(List.of("body"), "Value error, invalid body", null);
            }
        };
    }

    private ApiValidationException extraForbidden(String name, JsonNode value) {
        Map<String, Object> error = new LinkedHashMap<>();
        error.put("type", "extra_forbidden");
        error.put("loc", List.of("body", name));
        error.put("msg", "Extra inputs are not permitted");
        error.put("input", mapper.convertValue(value, Object.class));
        return new ApiValidationException(List.of(error));
    }

    private static <T> ResponseEntity<T> privateNoStore(T body) {
        return ResponseEntity.ok().header(HttpHeaders.CACHE_CONTROL, "private, no-store").body(body);
    }

    /** 길이가 달라도 같은 시간이 걸리도록 {@link MessageDigest#isEqual} 로 견준다(AdminController 와 같은 검사). */
    private void requireToken(String authorization) {
        byte[] actual = authorization.getBytes(StandardCharsets.UTF_8);
        if (!MessageDigest.isEqual(actual, expectedAuthorization)) {
            throw new ApiException(401, "Unauthorized");
        }
    }
}
