package com.acttub.actingapi.feature.blog.adapter.web;

import java.net.URI;
import java.time.Duration;

import com.acttub.actingapi.feature.blog.adapter.web.BlogDtos.PostDetail;
import com.acttub.actingapi.feature.blog.adapter.web.BlogDtos.PostList;
import com.acttub.actingapi.feature.blog.adapter.web.BlogDtos.PostSummary;
import com.acttub.actingapi.feature.blog.app.BlogService;
import com.acttub.actingapi.platform.security.ClientAddress;
import com.acttub.actingapi.platform.security.FixedWindowRateLimiter;
import com.acttub.actingapi.platform.web.ApiException;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * 블로그 공개 읽기(app.blog). 로그인 없이 받는다 — {@code AccessTokenFilter}·동의 게이트·클라이언트 판 헤더 검사가 모두
 * {@code /v2/blog/} 를 건너뛰므로 만료 토큰이나 헤더 없는 서버 렌더가 막히지 않는다. 게시된 글만 나간다.
 */
@RestController
class BlogController {
    private static final int PER_IP_PER_MINUTE = 120;

    private final BlogService blog;
    private final FixedWindowRateLimiter limiter;
    private final ClientAddress addresses;

    BlogController(BlogService blog, FixedWindowRateLimiter limiter, ClientAddress addresses) {
        this.blog = blog;
        this.limiter = limiter;
        this.addresses = addresses;
    }

    @Operation(summary = "List Blog Posts", operationId = "list_blog_posts_v2_blog_posts_get", tags = "v2-blog",
            description = "게시된 글만 새것부터. category 로 거르고 limit(1~50, 기본 20)까지.")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "Successful Response",
                content = @Content(schema = @Schema(implementation = PostList.class))),
        @ApiResponse(responseCode = "422", description = "Validation Error",
                content = @Content(schema = @Schema(ref = "#/components/schemas/HTTPValidationError")))
    })
    @GetMapping("/v2/blog/posts")
    ResponseEntity<PostList> list(
            @Parameter(schema = @Schema(type = "string", allowableValues = {"practice", "admissions", "audition", "news"}))
            @RequestParam(name = "category", required = false) String category,
            @Parameter(schema = @Schema(type = "integer", defaultValue = "20", minimum = "1", maximum = "50"))
            @RequestParam(name = "limit", defaultValue = "20") int limit,
            HttpServletRequest request) {
        throttle(request);
        PostList body = new PostList(blog.published(category, limit).stream().map(PostSummary::of).toList());
        return ResponseEntity.ok().cacheControl(CacheControl.maxAge(Duration.ofSeconds(60)).cachePublic()).body(body);
    }

    @Operation(summary = "Get Blog Post", operationId = "get_blog_post_v2_blog_posts__slug__get", tags = "v2-blog",
            description = "게시된 글 한 편. 없거나 초안이면 404 post_not_found.")
    @ApiResponses({
        @ApiResponse(responseCode = "200", description = "Successful Response",
                content = @Content(schema = @Schema(implementation = PostDetail.class))),
        @ApiResponse(responseCode = "404", description = "Not Found")
    })
    @GetMapping("/v2/blog/posts/{slug}")
    ResponseEntity<PostDetail> get(@PathVariable("slug") String slug, HttpServletRequest request) {
        throttle(request);
        return ResponseEntity.ok().cacheControl(CacheControl.maxAge(Duration.ofSeconds(60)).cachePublic())
                .body(PostDetail.of(blog.published(slug)));
    }

    @Operation(summary = "Get Blog Image", operationId = "get_blog_image_v2_blog_images__name__get", tags = "v2-blog",
            description = "운영자가 올린 이미지. 한시적 스토리지 주소로 302 넘긴다. 없으면 404 image_not_found.")
    @ApiResponse(responseCode = "302", description = "Found")
    @GetMapping("/v2/blog/images/{name}")
    ResponseEntity<Void> image(@PathVariable("name") String name, HttpServletRequest request) {
        throttle(request);
        return ResponseEntity.status(302).location(URI.create(blog.imageLocation(name)))
                .header(HttpHeaders.CACHE_CONTROL, "public, max-age=1800").build();
    }

    private void throttle(HttpServletRequest request) {
        if (!limiter.allow("public-blog-ip:" + addresses.of(request), PER_IP_PER_MINUTE)) {
            throw new ApiException(429, "rate limit exceeded");
        }
    }
}
