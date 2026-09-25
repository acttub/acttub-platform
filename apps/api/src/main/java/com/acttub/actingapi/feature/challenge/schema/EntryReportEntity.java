package com.acttub.actingapi.feature.challenge.schema;
import java.time.Instant;
import java.util.UUID;
import com.acttub.actingapi.platform.schema.*;
import jakarta.persistence.*;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

@Entity
@Table(name="entry_reports")
public class EntryReportEntity extends AppGeneratedUuidEntity {
    @Convert(converter=EntryReportTarget.JpaConverter.class)
    @Column(name="target_type", nullable=false, columnDefinition="text")
    private EntryReportTarget targetType;
    @Column(name="target_id", nullable=false)
    private UUID targetId;
    @Column(name="reporter_id", nullable=false)
    private UUID reporterId;
    @Convert(converter=EntryReportReason.JpaConverter.class)
    @Column(name="reason", nullable=false, columnDefinition="text")
    private EntryReportReason reason;
    @Column(name="note", nullable=true)
    private String note;
    @Convert(converter=EntryReportStatus.JpaConverter.class)
    @Column(name="status", nullable=false, columnDefinition="text")
    private EntryReportStatus status;
    @Convert(converter=EntryReportResolution.JpaConverter.class)
    @Column(name="resolution", nullable=true, columnDefinition="text")
    private EntryReportResolution resolution;
    @Column(name="reviewed_by", nullable=true)
    private String reviewedBy;
    @Column(name="reviewed_at", nullable=true)
    private Instant reviewedAt;
    @Column(name="resolution_note", nullable=true)
    private String resolutionNote;
    @Column(name="target_version", nullable=false)
    private int targetVersion;
    @Column(name="target_text", nullable=true)
    private String targetText;
    @Column(name="request_id", nullable=false)
    private UUID requestId;
    @JdbcTypeCode(SqlTypes.CHAR)
    @Column(name="request_fingerprint", nullable=false, columnDefinition="char(64)")
    private String requestFingerprint;
    @Column(name="created_at", nullable=false)
    private Instant createdAt;
    protected EntryReportEntity() { }
    public EntryReportTarget getTargetType() { return targetType; }
    public UUID getTargetId() { return targetId; }
    public UUID getReporterId() { return reporterId; }
    public EntryReportReason getReason() { return reason; }
    public String getNote() { return note; }
    public EntryReportStatus getStatus() { return status; }
    public EntryReportResolution getResolution() { return resolution; }
    public String getReviewedBy() { return reviewedBy; }
    public Instant getReviewedAt() { return reviewedAt; }
    public String getResolutionNote() { return resolutionNote; }
    public int getTargetVersion() { return targetVersion; }
    public String getTargetText() { return targetText; }
    public UUID getRequestId() { return requestId; }
    public String getRequestFingerprint() { return requestFingerprint; }
    public Instant getCreatedAt() { return createdAt; }
}
