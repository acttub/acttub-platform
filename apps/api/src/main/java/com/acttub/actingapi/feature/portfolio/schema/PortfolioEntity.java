package com.acttub.actingapi.feature.portfolio.schema;

import java.time.Instant;
import java.util.UUID;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

/**
 * {@code portfolios} — 회원당 하나이고 처음 편집할 때 생긴다. PK 가 {@code user_id} 로
 * <b>FK 겸 PK</b> 다 (apps/api/CONTRACT.md §5-3-2).
 *
 * <p>공유 링크는 기본 꺼짐이다. {@code share_slug} 는 처음 켤 때 생기고 꺼도 남아, 다시 켜면
 * 같은 주소가 열린다 (ADR-030).
 */
@Entity
@Table(name = "portfolios")
public class PortfolioEntity {

    @Id
    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Column(name = "intro")
    private String intro;

    @Column(name = "share_enabled", nullable = false)
    private boolean shareEnabled;

    @Column(name = "share_slug")
    private String shareSlug;

    @Column(name = "created_at", nullable = false, insertable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false, insertable = false, updatable = false)
    private Instant updatedAt;

    protected PortfolioEntity() {
    }

    public PortfolioEntity(UUID userId, String intro) {
        this.userId = userId;
        this.intro = intro;
    }

    public UUID getUserId() {
        return userId;
    }

    public String getIntro() {
        return intro;
    }

    public boolean isShareEnabled() {
        return shareEnabled;
    }

    public String getShareSlug() {
        return shareSlug;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }
}
