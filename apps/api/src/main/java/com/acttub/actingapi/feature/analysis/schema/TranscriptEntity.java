package com.acttub.actingapi.feature.analysis.schema;

import com.acttub.actingapi.platform.schema.AppGeneratedUuidEntity;
import java.util.UUID;
import jakarta.persistence.*;

@Entity
@Table(name = "transcripts")
public class TranscriptEntity extends AppGeneratedUuidEntity {

    @Column(name = "session_id", nullable = false)
    UUID sessionId;

    @Column(name = "ord", nullable = false)
    int ord;

    @Column(name = "text", nullable = false)
    String text;

    protected TranscriptEntity() {
    }

    public TranscriptEntity(UUID id, UUID sessionId, int ord, String text) {
        super(id);
        this.sessionId = sessionId;
        this.ord = ord;
        this.text = text;
    }
}
