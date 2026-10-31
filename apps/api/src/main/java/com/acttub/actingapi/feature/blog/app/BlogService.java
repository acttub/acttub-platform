package com.acttub.actingapi.feature.blog.app;

import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.UnaryOperator;
import java.util.regex.Pattern;

import com.acttub.actingapi.feature.blog.domain.BlogDraft;
import com.acttub.actingapi.feature.blog.domain.BlogPost;
import com.acttub.actingapi.feature.blog.domain.BlogRules;
import com.acttub.actingapi.platform.web.ApiException;
import com.acttub.actingapi.platform.web.ApiValidationException;

/** 블로그 글(app.blog) — 공개 읽기와 운영자의 쓰기. 로그인 없이 읽고, 초안은 공개 경로에 나가지 않는다. */
public class BlogService {
    public static final int DEFAULT_LIMIT = 20;
    public static final int MAX_LIMIT = 50;
    public static final long MAX_IMAGE_BYTES = 2L * 1024 * 1024;
    public static final String IMAGE_URL_PREFIX = "/v2/blog/images/";
    static final int IMAGE_VIEW_TTL_SECONDS = 3600;

    private static final Map<String, String> IMAGE_SUFFIXES =
            Map.of("image/png", ".png", "image/jpeg", ".jpg", "image/webp", ".webp");
    private static final Pattern IMAGE_NAME =
            Pattern.compile("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.(png|jpg|webp)$");

    private final BlogRepository posts;
    private final BlogImages images;
    private final Clock clock;

    public BlogService(BlogRepository posts, BlogImages images, Clock clock) {
        this.posts = posts;
        this.images = images;
        this.clock = clock;
    }

    public List<BlogPost> published(String category, int limit) {
        if (category != null && !BlogRules.CATEGORIES.contains(category)) {
            throw ApiValidationException.valueError(List.of("query", "category"),
                    "Value error, category must be one of " + BlogRules.CATEGORIES, category);
        }
        if (limit < 1 || limit > MAX_LIMIT) {
            throw ApiValidationException.valueError(List.of("query", "limit"),
                    "Value error, limit must be between 1 and " + MAX_LIMIT, limit);
        }
        return posts.published(category, limit);
    }

    public BlogPost published(String slug) {
        return posts.findPublished(slug).orElseThrow(() -> new ApiException(404, "post_not_found"));
    }

    public List<BlogPost> all() {
        return posts.all();
    }

    public BlogPost create(BlogDraft draft) {
        requireValid(draft);
        Instant now = clock.instant();
        Instant publishedAt = "published".equals(draft.status()) ? firstNonNull(draft.publishedAt(), now) : draft.publishedAt();
        return posts.insert(draft, publishedAt, now).orElseThrow(() -> new ApiException(409, "slug_taken"));
    }

    /** 지금 값에 {@code change} 를 얹은 결과로 바꾼다. 처음 게시하는 때에만 published_at 을 채운다. */
    public BlogPost update(UUID id, UnaryOperator<BlogDraft> change) {
        BlogPost current = posts.find(id).orElseThrow(() -> new ApiException(404, "post_not_found"));
        BlogDraft next = change.apply(withStoredPublishedAt(current));
        requireValid(next);
        Instant now = clock.instant();
        Instant publishedAt = next.publishedAt();
        if (publishedAt == null && "published".equals(next.status())) {
            publishedAt = now;
        }
        return posts.update(id, next, publishedAt, now).orElseThrow(() -> new ApiException(409, "slug_taken"));
    }

    /** 운영자가 올린 이미지. 서버가 직접 저장하고, 글에 넣을 공개 주소를 돌려준다. */
    public String uploadImage(String contentType, byte[] content) {
        String suffix = contentType == null ? null : IMAGE_SUFFIXES.get(contentType);
        if (suffix == null) {
            throw new ApiException(415, "unsupported_media_type");
        }
        if (content.length > MAX_IMAGE_BYTES) {
            throw new ApiException(413, "upload_too_large");
        }
        String name = UUID.randomUUID() + suffix;
        images.upload("blog/" + name, contentType, content);
        return IMAGE_URL_PREFIX + name;
    }

    /** 공개 이미지 주소가 가리킬 한시적 스토리지 주소. */
    public String imageLocation(String name) {
        String url = IMAGE_NAME.matcher(name).matches() ? images.viewUrl("blog/" + name, IMAGE_VIEW_TTL_SECONDS) : null;
        if (url == null) {
            throw new ApiException(404, "image_not_found");
        }
        return url;
    }

    private static BlogDraft withStoredPublishedAt(BlogPost current) {
        BlogDraft d = current.draft();
        return new BlogDraft(d.slug(), d.title(), d.summary(), d.category(), d.coverImageUrl(), d.bodyMarkdown(),
                d.appCta(), d.status(), current.publishedAt());
    }

    private static Instant firstNonNull(Instant a, Instant b) {
        return a != null ? a : b;
    }

    private static void requireValid(BlogDraft draft) {
        BlogRules.Violation violation = BlogRules.firstViolation(draft);
        if (violation != null) {
            throw ApiValidationException.valueError(List.of("body", violation.field()),
                    "Value error, " + violation.message(), null);
        }
    }
}
