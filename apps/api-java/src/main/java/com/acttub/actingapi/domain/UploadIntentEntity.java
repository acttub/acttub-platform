package com.acttub.actingapi.domain;
import java.time.Instant; import java.util.UUID; import jakarta.persistence.*; import org.hibernate.annotations.JdbcType;
@Entity @Table(name="upload_intents")
public class UploadIntentEntity extends AppGeneratedUuidEntity {
    @Column(name="user_id",nullable=false) UUID userId;
    @Convert(converter=UploadStatus.JpaConverter.class) @JdbcType(PgEnumJdbcType.class) @Column(name="status",nullable=false,columnDefinition="upload_status_t") UploadStatus status;
    @Column(name="storage_provider",nullable=false) String storageProvider; @Column(name="object_key",nullable=false) String objectKey; @Column(name="mime_type",nullable=false) String mimeType;
    @Column(name="size_bytes",nullable=false) long sizeBytes; @Column(name="duration_ms") Integer durationMs; @Column(name="etag") String etag;
    @Column(name="created_at",nullable=false,insertable=false,updatable=false) Instant createdAt; @Column(name="expires_at",nullable=false) Instant expiresAt; @Column(name="finalized_at") Instant finalizedAt;
    protected UploadIntentEntity(){} public UploadIntentEntity(UUID id,UUID userId,UploadStatus status,String storageProvider,String objectKey,String mimeType,long sizeBytes,Instant expiresAt){super(id);this.userId=userId;this.status=status;this.storageProvider=storageProvider;this.objectKey=objectKey;this.mimeType=mimeType;this.sizeBytes=sizeBytes;this.expiresAt=expiresAt;}
}
