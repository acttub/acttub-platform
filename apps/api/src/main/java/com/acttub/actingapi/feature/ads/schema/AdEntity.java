package com.acttub.actingapi.feature.ads.schema;

import java.time.Instant;
import java.util.UUID;

import com.acttub.actingapi.platform.schema.AppGeneratedUuidEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/**
 * {@code ads}(V66) — 직접(광고주)·자체(우리 앱) 광고 한 건.
 *
 * <p>값 목록 칸은 DB 값이자 API 값이라 문자열 그대로 둔다. 광고 표에는 CHECK 가 없고 허용 값은 {@code AdRules} 가 지킨다
 * (apps/api/CONTRACT.md §5-3). {@code slots} 는 {@code text[]} 이고 순서를 지킨다.
 */
@Entity
@Table(name = "ads")
public class AdEntity extends AppGeneratedUuidEntity {

    @Column(name = "kind", nullable = false)
    private String kind;

    @Column(name = "status", nullable = false)
    private String status;

    @JdbcTypeCode(SqlTypes.ARRAY)
    @Column(name = "slots", nullable = false, columnDefinition = "text[]")
    private String[] slots;

    @Column(name = "audience", nullable = false)
    private String audience;

    @Column(name = "priority", nullable = false)
    private int priority;

    @Column(name = "advertiser_name")
    private String advertiserName;

    @Column(name = "headline")
    private String headline;

    @Column(name = "body")
    private String body;

    @Column(name = "image_large_banner")
    private String imageLargeBanner;

    @Column(name = "image_banner")
    private String imageBanner;

    @Column(name = "image_medium_rectangle")
    private String imageMediumRectangle;

    @Column(name = "link_url")
    private String linkUrl;

    @Column(name = "app_path")
    private String appPath;

    @Column(name = "share_percent", nullable = false)
    private int sharePercent;

    /** 이 광고를 보이지 않을 사용자 id(V103). 운영자가 SQL 로만 넣고, 등록·수정 문장은 쓰지 않는다. */
    @JdbcTypeCode(SqlTypes.ARRAY)
    @Column(name = "excluded_user_ids", nullable = false, columnDefinition = "uuid[]", insertable = false,
            updatable = false)
    private UUID[] excludedUserIds = new UUID[0];

    @Column(name = "starts_at")
    private Instant startsAt;

    @Column(name = "ends_at")
    private Instant endsAt;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    protected AdEntity() {
    }

    public AdEntity(UUID id, String kind, String status, String[] slots, String audience, int priority,
            String advertiserName, String headline, String body, String imageLargeBanner, String imageBanner,
            String imageMediumRectangle, String linkUrl, String appPath, int sharePercent, Instant startsAt,
            Instant endsAt, Instant createdAt) {
        super(id);
        this.kind = kind;
        this.status = status;
        this.slots = slots.clone();
        this.audience = audience;
        this.priority = priority;
        this.advertiserName = advertiserName;
        this.headline = headline;
        this.body = body;
        this.imageLargeBanner = imageLargeBanner;
        this.imageBanner = imageBanner;
        this.imageMediumRectangle = imageMediumRectangle;
        this.linkUrl = linkUrl;
        this.appPath = appPath;
        this.sharePercent = sharePercent;
        this.startsAt = startsAt;
        this.endsAt = endsAt;
        this.createdAt = createdAt;
        this.updatedAt = createdAt;
    }

    public String getKind() {
        return kind;
    }

    public String getStatus() {
        return status;
    }

    public String[] getSlots() {
        return slots.clone();
    }

    public String getAudience() {
        return audience;
    }

    public int getPriority() {
        return priority;
    }

    public String getAdvertiserName() {
        return advertiserName;
    }

    public String getHeadline() {
        return headline;
    }

    public String getBody() {
        return body;
    }

    public String getImageLargeBanner() {
        return imageLargeBanner;
    }

    public String getImageBanner() {
        return imageBanner;
    }

    public String getImageMediumRectangle() {
        return imageMediumRectangle;
    }

    public String getLinkUrl() {
        return linkUrl;
    }

    public String getAppPath() {
        return appPath;
    }

    public int getSharePercent() {
        return sharePercent;
    }

    public UUID[] getExcludedUserIds() {
        return excludedUserIds == null ? new UUID[0] : excludedUserIds.clone();
    }

    public Instant getStartsAt() {
        return startsAt;
    }

    public Instant getEndsAt() {
        return endsAt;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }
}
