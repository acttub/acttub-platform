package com.acttub.actingapi.feature.poster.schema;

import java.time.Instant;
import java.util.UUID;

import com.acttub.actingapi.platform.schema.AppGeneratedUuidEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/**
 * {@code app_posters}(V29·V58·V73) — 앱 첫 화면 공지 포스터 한 장.
 *
 * <p>값 목록 칸은 DB 값이자 API 값이라 문자열 그대로 둔다. 허용 값은 DB 의 CHECK 와 {@code PosterRules} 가 지킨다.
 * {@code (slug, COALESCE(locale,''))} 유일은 표현식 유니크 인덱스 {@code uq_app_posters_slug_locale} 가 판정한다.
 * {@code platforms} 는 {@code text[]} 이고 순서를 지킨다.
 */
@Entity
@Table(name = "app_posters")
public class AppPosterEntity extends AppGeneratedUuidEntity {

    @Column(name = "slug", nullable = false)
    private String slug;

    @Column(name = "revision", nullable = false)
    private int revision;

    @Column(name = "active", nullable = false)
    private boolean active;

    @Column(name = "priority", nullable = false)
    private int priority;

    @Column(name = "starts_at")
    private Instant startsAt;

    @Column(name = "ends_at")
    private Instant endsAt;

    @JdbcTypeCode(SqlTypes.ARRAY)
    @Column(name = "platforms", nullable = false, columnDefinition = "text[]")
    private String[] platforms;

    @Column(name = "locale")
    private String locale;

    @Column(name = "min_app_version")
    private String minAppVersion;

    @Column(name = "frequency", nullable = false)
    private String frequency;

    @Column(name = "audience", nullable = false)
    private String audience;

    @Column(name = "dismissible", nullable = false)
    private boolean dismissible;

    @Column(name = "badge")
    private String badge;

    @Column(name = "title", nullable = false)
    private String title;

    @Column(name = "body")
    private String body;

    @Column(name = "image")
    private String image;

    @Column(name = "audio")
    private String audio;

    @Column(name = "cta_label")
    private String ctaLabel;

    @Column(name = "cta_action", nullable = false)
    private String ctaAction;

    @Column(name = "cta_target")
    private String ctaTarget;

    @Column(name = "footnote")
    private String footnote;

    @Column(name = "image_bg")
    private String imageBg;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    protected AppPosterEntity() {
    }

    public AppPosterEntity(UUID id, String slug, String[] platforms, String title, Instant createdAt) {
        super(id);
        this.slug = slug;
        this.revision = 1;
        this.platforms = platforms.clone();
        this.frequency = "daily";
        this.audience = "all";
        this.dismissible = true;
        this.title = title;
        this.ctaAction = "none";
        this.createdAt = createdAt;
        this.updatedAt = createdAt;
    }

    public String getSlug() {
        return slug;
    }

    public int getRevision() {
        return revision;
    }

    public boolean isActive() {
        return active;
    }

    public int getPriority() {
        return priority;
    }

    public Instant getStartsAt() {
        return startsAt;
    }

    public Instant getEndsAt() {
        return endsAt;
    }

    public String[] getPlatforms() {
        return platforms.clone();
    }

    public String getLocale() {
        return locale;
    }

    public String getMinAppVersion() {
        return minAppVersion;
    }

    public String getFrequency() {
        return frequency;
    }

    public String getAudience() {
        return audience;
    }

    public boolean isDismissible() {
        return dismissible;
    }

    public String getBadge() {
        return badge;
    }

    public String getTitle() {
        return title;
    }

    public String getBody() {
        return body;
    }

    public String getImage() {
        return image;
    }

    public String getAudio() {
        return audio;
    }

    public String getCtaLabel() {
        return ctaLabel;
    }

    public String getCtaAction() {
        return ctaAction;
    }

    public String getCtaTarget() {
        return ctaTarget;
    }

    public String getFootnote() {
        return footnote;
    }

    public String getImageBg() {
        return imageBg;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }
}
