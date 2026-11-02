package com.acttub.actingapi.feature.blog.adapter.web;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
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
import com.acttub.actingapi.feature.blog.adapter.web.BlogDtos.AdminPost;
import com.acttub.actingapi.feature.blog.adapter.web.BlogDtos.AdminPostList;
import com.acttub.actingapi.feature.blog.adapter.web.BlogDtos.ImageUploaded;
import com.acttub.actingapi.feature.blog.adapter.web.BlogDtos.PostFields;
import com.acttub.actingapi.feature.blog.app.BlogService;
import com.acttub.actingapi.feature.blog.domain.BlogDraft;
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
import org.springframework.http.MediaType;
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
import org.springframework.web.multipart.MultipartFile;

/**
 * 블로그의 운영 경로(app.blog). 다른 {@code /v2/admin} 과 같이 {@code ADMIN_OPS_TOKEN} 을 Bearer 로 받고, 토큰을 주지 않은
 * 기동에는 통째로 없다({@link AdminService#ENABLED_WHEN}). 지우기는 없다 — 내리는 것은 {@code status=draft} 다.
 */
@RestController
@RequestMapping("/v2/admin")
@ConditionalOnExpression(AdminService.ENABLED_WHEN)
class BlogAdminController {
    private final BlogService blog;
    private final ObjectMapper mapper;
    private final byte[] expectedAuthorization;
    private final Set<String> patchableFields;

    BlogAdminController(BlogService blog, ObjectMapper mapper, @Value("${ADMIN_OPS_TOKEN}") String adminToken) {
        this.blog = blog;
        this.mapper = mapper;
        this.expectedAuthorization = ("Bearer " + adminToken).getBytes(StandardCharsets.UTF_8);
        var snakeCase = new PropertyNamingStrategies.SnakeCaseStrategy();
        this.patchableFields = Arrays.stream(PostFields.class.getRecordComponents())
                .map(component -> snakeCase.translate(component.getName()))
                .collect(Collectors.toUnmodifiableSet());
    }

    @Operation(summary = "List Blog Posts", operationId = "list_blog_posts_v2_admin_blog_posts_get", tags = "admin",
            description = "초안까지 전부. 최근에 고친 것부터.")
    @ApiResponse(responseCode = "200", description = "Successful Response",
            content = @Content(schema = @Schema(implementation = AdminPostList.class)))
    @GetMapping("/blog/posts")
    ResponseEntity<AdminPostList> list(@RequestHeader(name = "authorization", defaultValue = "") String authorization) {
        requireToken(authorization);
        return ok(200, new AdminPostList(blog.all().stream().map(AdminPost::of).toList()));
    }

    @Operation(summary = "Create Blog Post", operationId = "create_blog_post_v2_admin_blog_posts_post", tags = "admin",
            description = "같은 slug 가 있으면 409 slug_taken. published 로 만들면 published_at 은 보낸 값이거나 지금이다.")
    @ApiResponse(responseCode = "201", description = "Created",
            content = @Content(schema = @Schema(implementation = AdminPost.class)))
    @PostMapping("/blog/posts")
    ResponseEntity<AdminPost> create(
            @Valid @RequestBody PostFields body,
            @RequestHeader(name = "authorization", defaultValue = "") String authorization) {
        requireToken(authorization);
        return ok(201, AdminPost.of(blog.create(body.toDraft())));
    }

    @Operation(summary = "Update Blog Post", operationId = "update_blog_post_v2_admin_blog_posts__id__patch", tags = "admin",
            description = "보낸 칸만 바꾼다. 처음 게시할 때 published_at 이 한 번 채워지고 이후 내렸다 올려도 그대로다. 없으면 404 post_not_found.")
    @ApiResponse(responseCode = "200", description = "Successful Response",
            content = @Content(schema = @Schema(implementation = AdminPost.class)))
    @PatchMapping("/blog/posts/{id}")
    ResponseEntity<AdminPost> update(
            @PathVariable UUID id,
            @RequestBody JsonNode body,
            @RequestHeader(name = "authorization", defaultValue = "") String authorization) {
        requireToken(authorization);
        if (!(body instanceof ObjectNode patch)) {
            throw ApiValidationException.valueError(List.of("body"), "Value error, body must be an object",
                    mapper.convertValue(body, Object.class));
        }
        for (Iterator<String> names = patch.fieldNames(); names.hasNext(); ) {
            String name = names.next();
            if (!patchableFields.contains(name)) {
                throw extraForbidden(name, patch.get(name));
            }
        }
        return ok(200, AdminPost.of(blog.update(id, merge(patch.deepCopy()))));
    }

    @Operation(summary = "Upload Blog Image", operationId = "upload_blog_image_v2_admin_blog_images_post", tags = "admin",
            description = "multipart 의 image 한 장. PNG·JPEG·WebP 만(아니면 415), 2MB 까지(넘으면 413). 글에 넣을 url 을 돌려준다.")
    @ApiResponse(responseCode = "200", description = "Successful Response",
            content = @Content(schema = @Schema(implementation = ImageUploaded.class)))
    @PostMapping(path = "/blog-images", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    ResponseEntity<ImageUploaded> uploadImage(
            @RequestParam("image") MultipartFile image,
            @RequestHeader(name = "authorization", defaultValue = "") String authorization) throws IOException {
        requireToken(authorization);
        return ok(200, new ImageUploaded(blog.uploadImage(image.getContentType(), image.getBytes())));
    }

    /** 지금 값 위에 보낸 칸을 얹는다. 칸의 형태가 틀리면 그 칸을 가리키는 422 다. */
    private UnaryOperator<BlogDraft> merge(ObjectNode changes) {
        return current -> {
            ObjectNode merged = mapper.valueToTree(PostFields.of(current));
            // 저장된 게시 시각은 트리를 거치지 않고 그대로 이어 간다. 보낸 값이 있을 때만 바뀐다.
            merged.remove("published_at");
            merged.setAll(changes);
            try {
                BlogDraft next = mapper.treeToValue(merged, PostFields.class).toDraft();
                return changes.has("published_at") ? next : new BlogDraft(next.slug(), next.title(), next.summary(),
                        next.category(), next.coverImageUrl(), next.bodyMarkdown(), next.appCta(), next.status(),
                        current.publishedAt());
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

    private static <T> ResponseEntity<T> ok(int status, T body) {
        return ResponseEntity.status(status).header(HttpHeaders.CACHE_CONTROL, "private, no-store").body(body);
    }

    /** 길이가 달라도 같은 시간이 걸리도록 {@link MessageDigest#isEqual} 로 견준다(AdminController 와 같은 검사). */
    private void requireToken(String authorization) {
        byte[] actual = authorization.getBytes(StandardCharsets.UTF_8);
        if (!MessageDigest.isEqual(actual, expectedAuthorization)) {
            throw new ApiException(401, "Unauthorized");
        }
    }
}
