package com.acttub.actingapi.feature.upload.schema;

import java.time.Instant;
import java.util.UUID;
import jakarta.persistence.*;

import com.acttub.actingapi.platform.schema.AppGeneratedUuidEntity;
import com.acttub.actingapi.platform.schema.UploadStatus;

@Entity
@Table(name = "upload_intents")
public class UploadIntentEntity extends AppGeneratedUuidEntity {

    @Column(name = "user_id", nullable = false)
    UUID userId;

    @Convert(converter = UploadStatus.JpaConverter.class)
    @Column(name = "status", nullable = false, columnDefinition = "text")
    UploadStatus status;

    @Column(name = "storage_provider", nullable = false)
    String storageProvider;

    @Column(name = "object_key", nullable = false)
    String objectKey;

    @Column(name = "mime_type", nullable = false)
    String mimeType;

    @Column(name = "size_bytes", nullable = false)
    long sizeBytes;

    @Column(name = "duration_ms")
    Integer durationMs;

    @Column(name = "etag")
    String etag;

    @Column(name = "created_at", nullable = false, insertable = false, updatable = false)
    Instant createdAt;

    @Column(name = "expires_at", nullable = false)
    Instant expiresAt;

    @Column(name = "finalized_at")
    Instant finalizedAt;

    protected UploadIntentEntity() {
    }

    public UploadIntentEntity(UUID id, UUID userId, UploadStatus status,
            String storageProvider, String objectKey, String mimeType, long sizeBytes,
            Instant expiresAt) {
        this(id, userId, status, storageProvider, objectKey, mimeType, sizeBytes, null, expiresAt);
    }

    public UploadIntentEntity(UUID id, UUID userId, UploadStatus status,
            String storageProvider, String objectKey, String mimeType, long sizeBytes,
            Integer durationMs, Instant expiresAt) {
        super(id);
        this.userId = userId;
        this.status = status;
        this.storageProvider = storageProvider;
        this.objectKey = objectKey;
        this.mimeType = mimeType;
        this.sizeBytes = sizeBytes;
        this.durationMs = durationMs;
        this.expiresAt = expiresAt;
    }

    public UUID getUserId() {
        return userId;
    }

    public UploadStatus getStatus() {
        return status;
    }

    public String getStorageProvider() {
        return storageProvider;
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

    public Integer getDurationMs() {
        return durationMs;
    }

    public String getEtag() {
        return etag;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public Instant getExpiresAt() {
        return expiresAt;
    }

    public Instant getFinalizedAt() {
        return finalizedAt;
    }
}
