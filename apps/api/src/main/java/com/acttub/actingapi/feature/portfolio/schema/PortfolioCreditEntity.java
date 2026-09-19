package com.acttub.actingapi.feature.portfolio.schema;

import java.time.Instant;
import java.util.UUID;

import com.acttub.actingapi.platform.schema.AppGeneratedUuidEntity;
import com.acttub.actingapi.platform.schema.PortfolioCreditKind;
import jakarta.persistence.Column;
import jakarta.persistence.Convert;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;

/** {@code portfolio_credits} — 포트폴리오의 경력 하나. {@code sort_order} 가 보이는 순서다. */
@Entity
@Table(name = "portfolio_credits")
public class PortfolioCreditEntity extends AppGeneratedUuidEntity {

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Column(name = "title", nullable = false)
    private String title;

    @Column(name = "role", nullable = false)
    private String role;

    @Column(name = "year", nullable = false)
    private int year;

    @Convert(converter = PortfolioCreditKind.JpaConverter.class)
    @Column(name = "kind", nullable = false, columnDefinition = "text")
    private PortfolioCreditKind kind;

    @Column(name = "sort_order", nullable = false)
    private int sortOrder;

    @Column(name = "created_at", nullable = false, insertable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false, insertable = false, updatable = false)
    private Instant updatedAt;

    protected PortfolioCreditEntity() {
    }

    public PortfolioCreditEntity(
            UUID id,
            UUID userId,
            String title,
            String role,
            int year,
            PortfolioCreditKind kind,
            int sortOrder) {
        super(id);
        this.userId = userId;
        this.title = title;
        this.role = role;
        this.year = year;
        this.kind = kind;
        this.sortOrder = sortOrder;
    }

    public UUID getUserId() {
        return userId;
    }

    public String getTitle() {
        return title;
    }

    public String getRole() {
        return role;
    }

    public int getYear() {
        return year;
    }

    public PortfolioCreditKind getKind() {
        return kind;
    }

    public int getSortOrder() {
        return sortOrder;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }
}
