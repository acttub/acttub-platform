package com.acttub.actingapi.feature.memory.schema;

import java.time.Instant;
import java.util.UUID;

import com.acttub.actingapi.platform.schema.ActorMemoryAuthor;
import com.acttub.actingapi.platform.schema.ActorMemoryField;
import com.acttub.actingapi.platform.schema.AppGeneratedUuidEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Convert;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;

/** {@code actor_memory_entries}의 런타임·스키마 검증 매핑. */
@Entity
@Table(name = "actor_memory_entries")
public class ActorMemoryEntryEntity extends AppGeneratedUuidEntity {

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Convert(converter = ActorMemoryField.JpaConverter.class)
    @Column(name = "field", nullable = false, columnDefinition = "text")
    private ActorMemoryField field;

    @Column(name = "value", nullable = false)
    private String value;

    @Convert(converter = ActorMemoryAuthor.JpaConverter.class)
    @Column(name = "written_by", nullable = false, columnDefinition = "text")
    private ActorMemoryAuthor writtenBy;

    @Column(name = "source_practice_session_id")
    private UUID sourcePracticeSessionId;

    @Column(name = "created_at", nullable = false, insertable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false, insertable = false, updatable = false)
    private Instant updatedAt;

    protected ActorMemoryEntryEntity() {
    }

    public ActorMemoryEntryEntity(
            UUID id,
            UUID userId,
            ActorMemoryField field,
            String value,
            ActorMemoryAuthor writtenBy,
            UUID sourcePracticeSessionId) {
        super(id);
        this.userId = userId;
        this.field = field;
        this.value = value;
        this.writtenBy = writtenBy;
        this.sourcePracticeSessionId = sourcePracticeSessionId;
    }

    public UUID getUserId() {
        return userId;
    }

    public ActorMemoryField getField() {
        return field;
    }

    public String getValue() {
        return value;
    }

    public ActorMemoryAuthor getWrittenBy() {
        return writtenBy;
    }

    public UUID getSourcePracticeSessionId() {
        return sourcePracticeSessionId;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }
}
