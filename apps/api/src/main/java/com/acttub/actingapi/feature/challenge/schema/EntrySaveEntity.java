package com.acttub.actingapi.feature.challenge.schema;
import java.time.Instant;
import java.util.UUID;
import com.acttub.actingapi.platform.schema.*;
import jakarta.persistence.*;

@Entity
@Table(name="entry_saves")
public class EntrySaveEntity extends AppGeneratedUuidEntity {
    @Column(name="entry_id", nullable=false)
    private UUID entryId;
    @Column(name="user_id", nullable=false)
    private UUID userId;
    @Column(name="created_at", nullable=false)
    private Instant createdAt;
    protected EntrySaveEntity() { }
    public UUID getEntryId() { return entryId; }
    public UUID getUserId() { return userId; }
    public Instant getCreatedAt() { return createdAt; }
}
