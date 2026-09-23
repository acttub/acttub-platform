package com.acttub.actingapi.feature.challenge.schema;
import java.time.Instant;
import java.util.UUID;
import com.acttub.actingapi.platform.schema.*;
import jakarta.persistence.*;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

@Entity
@Table(name="entry_comments")
public class EntryCommentEntity extends AppGeneratedUuidEntity {
    @Column(name="entry_id", nullable=false)
    private UUID entryId;
    @Column(name="user_id", nullable=false)
    private UUID userId;
    @Column(name="body", nullable=true)
    private String body;
    @Convert(converter=EntryCommentStatus.JpaConverter.class)
    @Column(name="status", nullable=false, columnDefinition="text")
    private EntryCommentStatus status;
    @Column(name="request_id", nullable=false)
    private UUID requestId;
    @JdbcTypeCode(SqlTypes.CHAR)
    @Column(name="request_fingerprint", nullable=false, columnDefinition="char(64)")
    private String requestFingerprint;
    @Column(name="created_at", nullable=false)
    private Instant createdAt;
    @Column(name="deleted_at", nullable=true)
    private Instant deletedAt;
    protected EntryCommentEntity() { }
    public UUID getEntryId() { return entryId; }
    public UUID getUserId() { return userId; }
    public String getBody() { return body; }
    public EntryCommentStatus getStatus() { return status; }
    public UUID getRequestId() { return requestId; }
    public String getRequestFingerprint() { return requestFingerprint; }
    public Instant getCreatedAt() { return createdAt; }
    public Instant getDeletedAt() { return deletedAt; }
}
