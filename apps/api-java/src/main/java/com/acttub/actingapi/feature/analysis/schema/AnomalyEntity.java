package com.acttub.actingapi.feature.analysis.schema;
import com.acttub.actingapi.platform.schema.IntentImpact; import com.acttub.actingapi.platform.schema.PgEnumJdbcType; import com.acttub.actingapi.platform.schema.Severity; import java.util.UUID; import jakarta.persistence.*; import org.hibernate.annotations.JdbcType;
@Entity @Table(name="anomalies")
public class AnomalyEntity {
    @Id @GeneratedValue(strategy=GenerationType.IDENTITY) @Column(name="id") Long id;
    @Column(name="summary_id",nullable=false) UUID summaryId; @Column(name="sort_order",nullable=false) int sortOrder; @Column(name="start_ts",nullable=false) String startTs; @Column(name="end_ts",nullable=false) String endTs;
    @Column(name="dimension",nullable=false) String dimension; @Column(name="what",nullable=false) String what; @Column(name="why_odd",nullable=false) String whyOdd; @Column(name="likely_cause",nullable=false) String likelyCause; @Column(name="impact_on_intent",nullable=false) String impactOnIntent;
    @Column(name="overlaps_key_moment",nullable=false) boolean overlapsKeyMoment; @Column(name="on_key_dimension",nullable=false) boolean onKeyDimension;
    @Convert(converter=IntentImpact.JpaConverter.class) @JdbcType(PgEnumJdbcType.class) @Column(name="intent_impact",nullable=false,columnDefinition="intent_impact_t") IntentImpact intentImpact;
    @Convert(converter=Severity.JpaConverter.class) @JdbcType(PgEnumJdbcType.class) @Column(name="severity",nullable=false,columnDefinition="severity_t") Severity severity;
    @Column(name="severity_reason",nullable=false) String severityReason; protected AnomalyEntity(){}
    public AnomalyEntity(UUID summaryId,IntentImpact impact,Severity severity){this.summaryId=summaryId;this.sortOrder=0;this.startTs="0";this.endTs="1";this.dimension="d";this.what="w";this.whyOdd="o";this.likelyCause="c";this.impactOnIntent="i";this.intentImpact=impact;this.severity=severity;this.severityReason="r";}
}
