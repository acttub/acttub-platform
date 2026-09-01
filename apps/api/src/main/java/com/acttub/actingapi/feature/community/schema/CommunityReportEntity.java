package com.acttub.actingapi.feature.community.schema;

import java.time.Instant;
import java.util.UUID;
import jakarta.persistence.*;

import com.acttub.actingapi.platform.schema.AppGeneratedUuidEntity;
import com.acttub.actingapi.platform.schema.ReportReason;
import com.acttub.actingapi.platform.schema.ReportStatus;
import com.acttub.actingapi.platform.schema.ReportTargetType;

@Entity
@Table(name = "community_reports")
public class CommunityReportEntity extends AppGeneratedUuidEntity {

    @Column(name = "reporter_id", nullable = false)
    UUID reporterId;

    @Convert(converter = ReportTargetType.JpaConverter.class)
    @Column(name = "target_type", nullable = false, columnDefinition = "text")
    ReportTargetType targetType;

    @Column(name = "target_id", nullable = false)
    UUID targetId;

    @Convert(converter = ReportReason.JpaConverter.class)
    @Column(name = "reason", nullable = false, columnDefinition = "text")
    ReportReason reason;

    @Column(name = "detail")
    String detail;

    @Convert(converter = ReportStatus.JpaConverter.class)
    @Column(name = "status", nullable = false, columnDefinition = "text")
    ReportStatus status;

    @Column(name = "created_at", nullable = false, insertable = false, updatable = false)
    Instant createdAt;

    protected CommunityReportEntity() {
    }

    public CommunityReportEntity(UUID id, UUID reporterId, ReportTargetType targetType,
            UUID targetId, ReportReason reason, ReportStatus status) {
        super(id);
        this.reporterId = reporterId;
        this.targetType = targetType;
        this.targetId = targetId;
        this.reason = reason;
        this.status = status;
    }
}
