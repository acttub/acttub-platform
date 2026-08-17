package com.acttub.actingapi.feature.community.schema;
import java.time.Instant; import java.util.UUID; import jakarta.persistence.*; import org.hibernate.annotations.JdbcType;
import com.acttub.actingapi.platform.schema.AppGeneratedUuidEntity;
import com.acttub.actingapi.platform.schema.PgEnumJdbcType;
import com.acttub.actingapi.platform.schema.ReportReason;
import com.acttub.actingapi.platform.schema.ReportStatus;
import com.acttub.actingapi.platform.schema.ReportTargetType;
@Entity @Table(name="community_reports")
public class CommunityReportEntity extends AppGeneratedUuidEntity {
    @Column(name="reporter_id",nullable=false) UUID reporterId;
    @Convert(converter=ReportTargetType.JpaConverter.class) @JdbcType(PgEnumJdbcType.class) @Column(name="target_type",nullable=false,columnDefinition="report_target_type_t") ReportTargetType targetType;
    @Column(name="target_id",nullable=false) UUID targetId;
    @Convert(converter=ReportReason.JpaConverter.class) @JdbcType(PgEnumJdbcType.class) @Column(name="reason",nullable=false,columnDefinition="report_reason_t") ReportReason reason;
    @Column(name="detail") String detail;
    @Convert(converter=ReportStatus.JpaConverter.class) @JdbcType(PgEnumJdbcType.class) @Column(name="status",nullable=false,columnDefinition="report_status_t") ReportStatus status;
    @Column(name="created_at",nullable=false,insertable=false,updatable=false) Instant createdAt;
    protected CommunityReportEntity(){} public CommunityReportEntity(UUID id,UUID reporterId,ReportTargetType targetType,UUID targetId,ReportReason reason,ReportStatus status){super(id);this.reporterId=reporterId;this.targetType=targetType;this.targetId=targetId;this.reason=reason;this.status=status;}
}
