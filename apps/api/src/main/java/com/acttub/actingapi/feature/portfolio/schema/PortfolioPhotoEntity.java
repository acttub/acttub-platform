package com.acttub.actingapi.feature.portfolio.schema;

import java.time.Instant;
import java.util.UUID;

import com.acttub.actingapi.platform.schema.AppGeneratedUuidEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;

/**
 * {@code portfolio_photos} — 포트폴리오의 사진 하나. 객체는 영상과 같은 저장소에 두되 영상·프로필
 * 사진과 별개다.
 *
 * <p>올리기는 영상과 같이 "주소 받기 → 직접 올리기 → 끝 알리기" 다. 끝나기 전의 행은
 * {@code uploaded_at} 이 비어 있고, 목록 끝에 붙을 때 {@code sort_order} 를 얻는다.
 */
@Entity
@Table(name = "portfolio_photos")
public class PortfolioPhotoEntity extends AppGeneratedUuidEntity {

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Column(name = "object_key", nullable = false)
    private String objectKey;

    @Column(name = "mime_type", nullable = false)
    private String mimeType;

    @Column(name = "size_bytes", nullable = false)
    private long sizeBytes;

    @Column(name = "sort_order")
    private Integer sortOrder;

    @Column(name = "created_at", nullable = false, insertable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "expires_at", nullable = false)
    private Instant expiresAt;

    @Column(name = "uploaded_at")
    private Instant uploadedAt;

    protected PortfolioPhotoEntity() {
    }

    public PortfolioPhotoEntity(
            UUID id,
            UUID userId,
            String objectKey,
            String mimeType,
            long sizeBytes,
            Instant expiresAt) {
        super(id);
        this.userId = userId;
        this.objectKey = objectKey;
        this.mimeType = mimeType;
        this.sizeBytes = sizeBytes;
        this.expiresAt = expiresAt;
    }

    public UUID getUserId() {
        return userId;
    }

    public String getObjectKey() {
        return objectKey;
    }

    public String getMimeType() {
        return mimeType;
    }

    public long getSizeBytes() {
        return sizeBytes;
    }

    public Integer getSortOrder() {
        return sortOrder;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public Instant getExpiresAt() {
        return expiresAt;
    }

    public Instant getUploadedAt() {
        return uploadedAt;
    }
}
