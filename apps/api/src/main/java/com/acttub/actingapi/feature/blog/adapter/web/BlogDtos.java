package com.acttub.actingapi.feature.blog.adapter.web;

import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.format.DateTimeParseException;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.blog.domain.BlogDraft;
import com.acttub.actingapi.feature.blog.domain.BlogPost;
import com.acttub.actingapi.platform.web.ApiValidationException;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.annotation.JsonNaming;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotNull;

/** 블로그(app.blog)의 요청·응답. 칸 이름은 snake_case 다. */
final class BlogDtos {
    private static final String[] CATEGORIES = {"practice", "admissions", "audition", "news"};
    private static final String[] APP_CTAS = {"coaching", "reading", "challenge", "none"};

    private BlogDtos() {
    }

    // ─── 공개 ───────────────────────────────────────────────────────────

    @Schema(name = "BlogPostSummary", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record PostSummary(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String slug,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String title,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String summary,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, allowableValues = {"practice", "admissions", "audition", "news"})
            String category,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true) String coverImageUrl,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) Instant publishedAt,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) int readingMinutes) {

        static PostSummary of(BlogPost post) {
            BlogDraft d = post.draft();
            return new PostSummary(d.slug(), d.title(), d.summary(), d.category(), d.coverImageUrl(),
                    post.publishedAt(), post.readingMinutes());
        }
    }

    @Schema(name = "BlogPostList", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    record PostList(@Schema(requiredMode = Schema.RequiredMode.REQUIRED) List<PostSummary> items) {
    }

    @Schema(name = "BlogPostDetail", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record PostDetail(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String slug,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String title,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String summary,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, allowableValues = {"practice", "admissions", "audition", "news"})
            String category,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true) String coverImageUrl,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) Instant publishedAt,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) int readingMinutes,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String authorName,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String bodyMarkdown,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, allowableValues = {"coaching", "reading", "challenge", "none"})
            String appCta) {

        static PostDetail of(BlogPost post) {
            BlogDraft d = post.draft();
            return new PostDetail(d.slug(), d.title(), d.summary(), d.category(), d.coverImageUrl(),
                    post.publishedAt(), post.readingMinutes(), post.authorName(), d.bodyMarkdown(), d.appCta());
        }
    }

    // ─── 운영 ───────────────────────────────────────────────────────────

    /** 만들기·고치기가 받는 칸. 고치기는 보낸 칸만 얹는다. */
    @Schema(name = "BlogPostFields", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record PostFields(
            @NotNull @Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "^[a-z0-9]+(-[a-z0-9]+)*$, 80자 이하")
            String slug,
            @NotNull @Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "120자 이하") String title,
            @NotNull @Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "160자 이하") String summary,
            @NotNull @Schema(requiredMode = Schema.RequiredMode.REQUIRED, allowableValues = {"practice", "admissions", "audition", "news"})
            String category,
            @Schema(nullable = true, description = "https 주소이거나 / 로 시작하는 경로(blog-images 가 돌려준 url)")
            String coverImageUrl,
            @NotNull @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String bodyMarkdown,
            @NotNull @Schema(requiredMode = Schema.RequiredMode.REQUIRED, allowableValues = {"coaching", "reading", "challenge", "none"})
            String appCta,
            @NotNull @Schema(requiredMode = Schema.RequiredMode.REQUIRED, allowableValues = {"draft", "published"})
            String status,
            @Schema(nullable = true, format = "date-time", description = "ISO-8601. 비우면 처음 게시할 때의 시각") String publishedAt) {

        BlogDraft toDraft() {
            return new BlogDraft(slug, title, summary, category, coverImageUrl, bodyMarkdown, appCta, status, parse(publishedAt));
        }

        private static Instant parse(String value) {
            if (value == null) {
                return null;
            }
            try {
                return OffsetDateTime.parse(value).toInstant();
            } catch (DateTimeParseException invalid) {
                throw ApiValidationException.valueError(List.of("body", "published_at"),
                        "Value error, published_at must be an ISO-8601 date-time", value);
            }
        }

        static PostFields of(BlogDraft d) {
            return new PostFields(d.slug(), d.title(), d.summary(), d.category(), d.coverImageUrl(),
                    d.bodyMarkdown(), d.appCta(), d.status(),
                    d.publishedAt() == null ? null : d.publishedAt().toString());
        }
    }

    @Schema(name = "AdminBlogPost", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    @JsonNaming(PropertyNamingStrategies.SnakeCaseStrategy.class)
    record AdminPost(
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) UUID id,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String slug,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String title,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String summary,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, allowableValues = {"practice", "admissions", "audition", "news"})
            String category,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true) String coverImageUrl,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String bodyMarkdown,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, allowableValues = {"coaching", "reading", "challenge", "none"})
            String appCta,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, allowableValues = {"draft", "published"}) String status,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) String authorName,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED, nullable = true) Instant publishedAt,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) int readingMinutes,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) Instant createdAt,
            @Schema(requiredMode = Schema.RequiredMode.REQUIRED) Instant updatedAt) {

        static AdminPost of(BlogPost post) {
            BlogDraft d = post.draft();
            return new AdminPost(post.id(), d.slug(), d.title(), d.summary(), d.category(), d.coverImageUrl(),
                    d.bodyMarkdown(), d.appCta(), d.status(), post.authorName(), post.publishedAt(),
                    post.readingMinutes(), post.createdAt(), post.updatedAt());
        }
    }

    @Schema(name = "AdminBlogPostList", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    record AdminPostList(@Schema(requiredMode = Schema.RequiredMode.REQUIRED) List<AdminPost> items) {
    }

    @Schema(name = "AdminBlogImage", additionalProperties = Schema.AdditionalPropertiesValue.FALSE)
    record ImageUploaded(@Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "글의 cover_image_url 이나 본문에 넣는 공개 주소") String url) {
    }
}
