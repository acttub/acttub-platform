package com.acttub.actingapi.feature.coach.schema;

import java.time.Instant;
import java.util.UUID;
import jakarta.persistence.*;

import com.acttub.actingapi.platform.schema.TurnRole;

@Entity
@Table(name = "coach_turns")
public class CoachTurnEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "id")
    Long id;

    @Column(name = "session_id", nullable = false)
    UUID sessionId;

    @Column(name = "turn_index", nullable = false)
    int turnIndex;

    @Convert(converter = TurnRole.JpaConverter.class)
    @Column(name = "role", nullable = false, columnDefinition = "text")
    TurnRole role;

    @Column(name = "text", nullable = false)
    String text;

    @Column(name = "created_at", nullable = false, insertable = false, updatable = false)
    Instant createdAt;

    protected CoachTurnEntity() {
    }

    public CoachTurnEntity(UUID sessionId, int turnIndex, TurnRole role, String text) {
        this.sessionId = sessionId;
        this.turnIndex = turnIndex;
        this.role = role;
        this.text = text;
    }
}
