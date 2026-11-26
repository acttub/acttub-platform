package com.acttub.actingapi.feature.community.schema;

import java.time.Instant;
import java.util.UUID;

import com.acttub.actingapi.platform.schema.AppGeneratedUuidEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;

/**
 * {@code community_post_images}(V87) — 게시판 글 사진의 올리기 장부. 올릴 자리를 만들 때 넣고, 글에 붙이면 {@code post_id}·
 * {@code sort_order} 를 채운다. 붙은 행은 순서와 올림 시각이 있어야 한다(CHECK).
 */
@Entity
@Table(name = "community_post_images")
public class CommunityPostImageEntity extends AppGeneratedUuidEntity {

    @Column(name = "post_id")
    UUID postId;

    @Column(name = "uploader_id", nullable = false, updatable = false)
    UUID uploaderId;

    @Column(name = "object_key", nullable = false, updatable = false)
    String objectKey;

    @Column(name = "mime_type", nullable = false, updatable = false)
    String mimeType;

    @Column(name = "size_bytes", nullable = false, updatable = false)
    long sizeBytes;

    @Column(name = "sort_order")
    Integer sortOrder;

    @Column(name = "created_at", nullable = false, updatable = false)
    Instant createdAt;

    @Column(name = "expires_at", nullable = false, updatable = false)
    Instant expiresAt;

    @Column(name = "uploaded_at")
    Instant uploadedAt;

    protected CommunityPostImageEntity() {
    }

    /** 아직 글에 붙지 않고 올라오지 않은 행. */
    public CommunityPostImageEntity(UUID id, UUID uploaderId, String objectKey, String mimeType, long sizeBytes,
            Instant createdAt, Instant expiresAt) {
        super(id);
        this.uploaderId = uploaderId;
        this.objectKey = objectKey;
        this.mimeType = mimeType;
        this.sizeBytes = sizeBytes;
        this.createdAt = createdAt;
        this.expiresAt = expiresAt;
    }

    public UUID getPostId() {
        return postId;
    }

    public UUID getUploaderId() {
        return uploaderId;
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

    public Instant getExpiresAt() {
        return expiresAt;
    }

    public Instant getUploadedAt() {
        return uploadedAt;
    }
}
