package com.acttub.actingapi.feature.analysis.schema;
import com.acttub.actingapi.platform.schema.AppGeneratedUuidEntity; import java.time.Instant; import java.util.UUID; import com.fasterxml.jackson.databind.JsonNode; import jakarta.persistence.*; import org.hibernate.annotations.JdbcTypeCode; import org.hibernate.type.SqlTypes;
@Entity @Table(name="summaries")
public class SummaryEntity extends AppGeneratedUuidEntity {
    @Column(name="session_id",nullable=false) UUID sessionId;
    @JdbcTypeCode(SqlTypes.JSON) @Column(name="observation",columnDefinition="jsonb") JsonNode observation;
    @Column(name="summary") String summary; @Column(name="intent_alignment") String intentAlignment; @Column(name="key_moment") String keyMoment; @Column(name="key_dimension") String keyDimension;
    @Column(name="model",nullable=false) String model; @Column(name="was_compressed",nullable=false) boolean wasCompressed;
    @JdbcTypeCode(SqlTypes.JSON) @Column(name="raw",nullable=false,columnDefinition="jsonb") JsonNode raw;
    @Column(name="created_at",nullable=false,insertable=false,updatable=false) Instant createdAt;
    @JdbcTypeCode(SqlTypes.JSON) @Column(name="observations_json",nullable=false,columnDefinition="jsonb") JsonNode observationsJson;
    @JdbcTypeCode(SqlTypes.JSON) @Column(name="uncertainties_json",nullable=false,columnDefinition="jsonb") JsonNode uncertaintiesJson;
    protected SummaryEntity(){} public SummaryEntity(UUID id,UUID sessionId,String model,JsonNode raw,JsonNode observations,JsonNode uncertainties){super(id);this.sessionId=sessionId;this.model=model;this.raw=raw;this.observationsJson=observations;this.uncertaintiesJson=uncertainties;}
    public JsonNode getObservation(){return observation;} public JsonNode getRaw(){return raw;} public JsonNode getObservationsJson(){return observationsJson;} public JsonNode getUncertaintiesJson(){return uncertaintiesJson;} public void setObservation(JsonNode value){observation=value;}
}
