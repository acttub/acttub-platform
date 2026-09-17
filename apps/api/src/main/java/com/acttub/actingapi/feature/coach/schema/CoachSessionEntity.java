package com.acttub.actingapi.feature.coach.schema;

import java.time.Instant;
import java.util.UUID;
import jakarta.persistence.*;

import com.acttub.actingapi.platform.schema.SessionStatus;
import com.acttub.actingapi.platform.schema.CloseReason;

@Entity
@Table(name = "coach_sessions")
public class CoachSessionEntity {

    @Id
    @Column(name = "id", nullable = false)
    UUID id;

    @Column(name = "practice_session_id", nullable = false)
    UUID practiceSessionId;

    @Column(name = "summary_id")
    UUID summaryId;

    @Convert(converter = SessionStatus.JpaConverter.class)
    @Column(name = "status", nullable = false, columnDefinition = "text")
    SessionStatus status;

    @Convert(converter = CloseReason.JpaConverter.class)
    @Column(name = "close_reason", columnDefinition = "text")
    CloseReason closeReason;

    @Column(name = "conversation_summary", nullable = false)
    String conversationSummary = "";

    @org.hibernate.annotations.JdbcTypeCode(org.hibernate.type.SqlTypes.JSON)
    @Column(name = "coaching_state_json", columnDefinition = "jsonb")
    com.fasterxml.jackson.databind.JsonNode coachingState;

    @Column(name = "state_revision", nullable = false)
    long stateRevision;

    public void structuredState(com.fasterxml.jackson.databind.JsonNode state, long revision, String reason) {
        this.coachingState = state;
        this.stateRevision = revision;
        if (reason != null && !reason.isBlank()) {
            this.closeReason = CloseReason.valueOf(reason.toUpperCase(java.util.Locale.ROOT));
        }
    }

    @Column(name = "created_at", nullable = false, insertable = false, updatable = false)
    Instant createdAt;

    @Column(name = "updated_at", nullable = false, insertable = false, updatable = false)
    Instant updatedAt;

    protected CoachSessionEntity() {
    }

    public CoachSessionEntity(UUID id, UUID practiceSessionId, SessionStatus status) {
        this(id, practiceSessionId, null, status, "");
    }

    public CoachSessionEntity(
            UUID id,
            UUID practiceSessionId,
            UUID summaryId,
            SessionStatus status,
            String conversationSummary) {
        this.id = id;
        this.practiceSessionId = practiceSessionId;
        this.summaryId = summaryId;
        this.status = status;
        this.conversationSummary = conversationSummary;
    }

    public void close(CloseReason reason) {
        this.status = SessionStatus.CLOSED;
        this.closeReason = reason;
    }
}
