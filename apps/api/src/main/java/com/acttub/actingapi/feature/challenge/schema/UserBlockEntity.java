package com.acttub.actingapi.feature.challenge.schema;
import java.time.Instant;
import java.util.UUID;
import com.acttub.actingapi.platform.schema.*;
import jakarta.persistence.*;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

@Entity
@Table(name="user_blocks")
public class UserBlockEntity extends AppGeneratedUuidEntity {
    @Column(name="blocker_id", nullable=false)
    private UUID blockerId;
    @Column(name="blocked_id", nullable=false)
    private UUID blockedId;
    @Column(name="created_at", nullable=false)
    private Instant createdAt;
    protected UserBlockEntity() { }
    public UUID getBlockerId() { return blockerId; }
    public UUID getBlockedId() { return blockedId; }
    public Instant getCreatedAt() { return createdAt; }
}
