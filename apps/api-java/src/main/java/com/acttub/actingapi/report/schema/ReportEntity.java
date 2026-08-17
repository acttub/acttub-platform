package com.acttub.actingapi.report.schema;
import java.time.Instant; import java.util.UUID; import com.fasterxml.jackson.databind.JsonNode; import jakarta.persistence.*; import org.hibernate.annotations.JdbcTypeCode; import org.hibernate.type.SqlTypes;
import com.acttub.actingapi.platform.schema.AppGeneratedUuidEntity;
@Entity @Table(name="reports")
public class ReportEntity extends AppGeneratedUuidEntity {
    @Column(name="session_id",nullable=false) UUID sessionId; @Column(name="headline",nullable=false) String headline;
    @JdbcTypeCode(SqlTypes.JSON) @Column(name="biggest_problem",nullable=false,columnDefinition="jsonb") JsonNode biggestProblem;
    @Column(name="evidence",nullable=false) String evidence; @Column(name="self_discovery",nullable=false) String selfDiscovery; @Column(name="encouragement",nullable=false) String encouragement; @Column(name="next_step",nullable=false) String nextStep;
    @Column(name="comparison",nullable=false) String comparison=""; @Column(name="created_at",nullable=false,insertable=false,updatable=false) Instant createdAt;
    protected ReportEntity(){} public ReportEntity(UUID id,UUID sessionId,String headline,JsonNode biggestProblem,String evidence,String selfDiscovery,String encouragement,String nextStep){super(id);this.sessionId=sessionId;this.headline=headline;this.biggestProblem=biggestProblem;this.evidence=evidence;this.selfDiscovery=selfDiscovery;this.encouragement=encouragement;this.nextStep=nextStep;}
}
