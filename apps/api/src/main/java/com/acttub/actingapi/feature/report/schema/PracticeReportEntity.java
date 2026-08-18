package com.acttub.actingapi.feature.report.schema;
import java.time.Instant; import java.util.UUID; import com.fasterxml.jackson.databind.JsonNode; import jakarta.persistence.*; import org.hibernate.annotations.JdbcTypeCode; import org.hibernate.type.SqlTypes;
import com.acttub.actingapi.platform.schema.AppGeneratedUuidEntity;
@Entity @Table(name="practice_reports")
public class PracticeReportEntity extends AppGeneratedUuidEntity {
    @Column(name="practice_session_id",nullable=false) UUID practiceSessionId; @Column(name="report_type",nullable=false) String reportType;
    @JdbcTypeCode(SqlTypes.JSON) @Column(name="report_json",nullable=false,columnDefinition="jsonb") JsonNode reportJson; @Column(name="source_handoff_id",nullable=false) UUID sourceHandoffId;
    @Column(name="created_at",nullable=false,insertable=false,updatable=false) Instant createdAt;
    protected PracticeReportEntity(){} public PracticeReportEntity(UUID id,UUID practiceSessionId,String reportType,JsonNode reportJson,UUID sourceHandoffId){super(id);this.practiceSessionId=practiceSessionId;this.reportType=reportType;this.reportJson=reportJson;this.sourceHandoffId=sourceHandoffId;}
}
