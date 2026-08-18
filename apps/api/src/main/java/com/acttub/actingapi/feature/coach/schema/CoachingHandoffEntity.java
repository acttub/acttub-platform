package com.acttub.actingapi.feature.coach.schema;

import java.time.Instant;
import java.util.UUID;
import com.fasterxml.jackson.databind.JsonNode;
import jakarta.persistence.*;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import com.acttub.actingapi.platform.schema.AppGeneratedUuidEntity;

@Entity
@Table(name = "coaching_handoffs")
public class CoachingHandoffEntity extends AppGeneratedUuidEntity {

    @Column(name = "coach_session_id", nullable = false)
    UUID coachSessionId;

    @Column(name = "practice_session_id", nullable = false)
    UUID practiceSessionId;

    @Column(name = "branch_kind", nullable = false)
    String branchKind;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "handoff_json", nullable = false, columnDefinition = "jsonb")
    JsonNode handoffJson;

    @Column(name = "created_at", nullable = false, insertable = false, updatable = false)
    Instant createdAt;

    protected CoachingHandoffEntity() {
    }

    public CoachingHandoffEntity(UUID id, UUID coachSessionId, UUID practiceSessionId,
            String branchKind, JsonNode handoffJson) {
        super(id);
        this.coachSessionId = coachSessionId;
        this.practiceSessionId = practiceSessionId;
        this.branchKind = branchKind;
        this.handoffJson = handoffJson;
    }
}
