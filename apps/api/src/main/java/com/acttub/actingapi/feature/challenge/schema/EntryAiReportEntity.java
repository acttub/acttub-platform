package com.acttub.actingapi.feature.challenge.schema;
import java.time.Instant;
import java.util.UUID;
import com.acttub.actingapi.platform.schema.*;
import jakarta.persistence.*;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

@Entity
@Table(name="entry_ai_reports")
public class EntryAiReportEntity extends AppGeneratedUuidEntity {
    @Column(name="entry_id", nullable=false)
    private UUID entryId;
    @Column(name="user_id", nullable=false)
    private UUID userId;
    @Column(name="job_id", nullable=false)
    private UUID jobId;
    @Convert(converter=EntryAiReportStatus.JpaConverter.class)
    @Column(name="status", nullable=false, columnDefinition="text")
    private EntryAiReportStatus status;
    @Column(name="model", nullable=true)
    private String model;
    @Column(name="format_version", nullable=false)
    private int formatVersion;
    @Column(name="attempt_count", nullable=false)
    private int attemptCount;
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name="result", nullable=true, columnDefinition="jsonb")
    private com.fasterxml.jackson.databind.JsonNode result;
    @Column(name="requested_at", nullable=false)
    private Instant requestedAt;
    @Column(name="completed_at", nullable=true)
    private Instant completedAt;
    @Column(name="purged_at", nullable=true)
    private Instant purgedAt;
    protected EntryAiReportEntity() { }
    public UUID getEntryId() { return entryId; }
    public UUID getUserId() { return userId; }
    public UUID getJobId() { return jobId; }
    public EntryAiReportStatus getStatus() { return status; }
    public String getModel() { return model; }
    public int getFormatVersion() { return formatVersion; }
    public int getAttemptCount() { return attemptCount; }
    public com.fasterxml.jackson.databind.JsonNode getResult() { return result; }
    public Instant getRequestedAt() { return requestedAt; }
    public Instant getCompletedAt() { return completedAt; }
    public Instant getPurgedAt() { return purgedAt; }
}
