package com.acttub.actingapi.feature.blog.schema;

import java.time.Instant;
import java.util.UUID;

import com.acttub.actingapi.platform.schema.AppGeneratedUuidEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;

/**
 * {@code blog_posts}(V80) — 운영자가 쓰고 웹 블로그가 읽는 글 한 편.
 *
 * <p>{@code category}·{@code app_cta}·{@code status} 는 DB 값이자 API 값이라 문자열 그대로 둔다. 허용 값은 DB 의 CHECK 와
 * {@code BlogRules} 가 지킨다. {@code slug} 유일은 {@code uq_blog_posts_slug} 가 판정한다. {@code author_name} 은 앱이 쓰지
 * 않고 DB 기본값으로 채워진다.
 */
@Entity
@Table(name = "blog_posts")
public class BlogPostEntity extends AppGeneratedUuidEntity {

    @Column(name = "slug", nullable = false)
    private String slug;

    @Column(name = "title", nullable = false)
    private String title;

    @Column(name = "summary", nullable = false)
    private String summary;

    @Column(name = "category", nullable = false)
    private String category;

    @Column(name = "body_markdown", nullable = false)
    private String bodyMarkdown;

    @Column(name = "cover_image_url")
    private String coverImageUrl;

    @Column(name = "app_cta", nullable = false)
    private String appCta;

    @Column(name = "status", nullable = false)
    private String status;

    @Column(name = "author_name", nullable = false, insertable = false, updatable = false)
    private String authorName;

    @Column(name = "published_at")
    private Instant publishedAt;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    protected BlogPostEntity() {
    }

    public BlogPostEntity(UUID id, String slug, String title, String summary, String category, String bodyMarkdown,
            String coverImageUrl, String appCta, String status, Instant publishedAt, Instant createdAt,
            Instant updatedAt) {
        super(id);
        this.slug = slug;
        this.title = title;
        this.summary = summary;
        this.category = category;
        this.bodyMarkdown = bodyMarkdown;
        this.coverImageUrl = coverImageUrl;
        this.appCta = appCta;
        this.status = status;
        this.publishedAt = publishedAt;
        this.createdAt = createdAt;
        this.updatedAt = updatedAt;
    }

    public String getSlug() {
        return slug;
    }

    public String getTitle() {
        return title;
    }

    public String getSummary() {
        return summary;
    }

    public String getCategory() {
        return category;
    }

    public String getBodyMarkdown() {
        return bodyMarkdown;
    }

    public String getCoverImageUrl() {
        return coverImageUrl;
    }

    public String getAppCta() {
        return appCta;
    }

    public String getStatus() {
        return status;
    }

    public String getAuthorName() {
        return authorName;
    }

    public Instant getPublishedAt() {
        return publishedAt;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }
}
