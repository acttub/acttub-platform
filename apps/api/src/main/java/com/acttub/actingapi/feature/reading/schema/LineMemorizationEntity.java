package com.acttub.actingapi.feature.reading.schema;

import java.time.Instant;
import java.util.UUID;

import com.acttub.actingapi.platform.schema.AppGeneratedUuidEntity;
import com.acttub.actingapi.platform.schema.MemorizationStatus;
import jakarta.persistence.Column;
import jakarta.persistence.Convert;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;

/**
 * {@code line_memorization} — (사람, 줄)마다 하나인 암기 표시 (reading.memorization).
 *
 * <p>행이 없으면 아직 표시하지 않은 줄이다. 회차를 지워도 남고 대본을 지우면 지운다.
 */
@Entity
@Table(name = "line_memorization")
public class LineMemorizationEntity extends AppGeneratedUuidEntity {

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Column(name = "line_id", nullable = false)
    private UUID lineId;

    @Convert(converter = MemorizationStatus.JpaConverter.class)
    @Column(name = "status", nullable = false, columnDefinition = "text")
    private MemorizationStatus status;

    @Column(name = "created_at", nullable = false, insertable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false, insertable = false, updatable = false)
    private Instant updatedAt;

    protected LineMemorizationEntity() {
    }

    public LineMemorizationEntity(UUID id, UUID userId, UUID lineId, MemorizationStatus status) {
        super(id);
        this.userId = userId;
        this.lineId = lineId;
        this.status = status;
    }

    public UUID getUserId() {
        return userId;
    }

    public UUID getLineId() {
        return lineId;
    }

    public MemorizationStatus getStatus() {
        return status;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }
}
