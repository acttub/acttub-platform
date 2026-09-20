package com.acttub.actingapi.feature.profile.schema;

import java.time.Instant;
import java.util.UUID;

import com.acttub.actingapi.platform.schema.ActingDirection;
import com.acttub.actingapi.platform.schema.AppGeneratedUuidEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Convert;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;

/** {@code user_profile_directions} — 회원이 고른 추구하는 방향마다 한 행. */
@Entity
@Table(name = "user_profile_directions")
public class UserProfileDirectionEntity extends AppGeneratedUuidEntity {

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Convert(converter = ActingDirection.JpaConverter.class)
    @Column(name = "direction", nullable = false, columnDefinition = "text")
    private ActingDirection direction;

    @Column(name = "created_at", nullable = false, insertable = false, updatable = false)
    private Instant createdAt;

    protected UserProfileDirectionEntity() {
    }

    public UserProfileDirectionEntity(UUID id, UUID userId, ActingDirection direction) {
        super(id);
        this.userId = userId;
        this.direction = direction;
    }

    public UUID getUserId() {
        return userId;
    }

    public ActingDirection getDirection() {
        return direction;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }
}
