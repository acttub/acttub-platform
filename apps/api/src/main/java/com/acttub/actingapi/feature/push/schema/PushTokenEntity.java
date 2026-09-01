package com.acttub.actingapi.feature.push.schema;

import java.time.Instant;
import java.util.UUID;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

/**
 * {@code push_tokens}의 런타임·스키마 검증 매핑.
 *
 * <p>ID는 앱이 아니라 DB default가 만든다. 신규 행은 Spring Data {@code save()}가 아니라
 * native upsert의 {@code RETURNING}으로 ID를 받은 뒤 이 엔티티로 조회한다.
 */
@Entity
@Table(name = "push_tokens")
public class PushTokenEntity {

    @Id
    @Column(name = "id", nullable = false, insertable = false, updatable = false)
    private UUID id;

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Column(name = "token", nullable = false)
    private String token;

    @Column(name = "platform", nullable = false)
    private String platform;

    @Column(name = "created_at", nullable = false, insertable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false, insertable = false, updatable = false)
    private Instant updatedAt;

    protected PushTokenEntity() {
    }

    public UUID getId() {
        return id;
    }

    public UUID getUserId() {
        return userId;
    }

    public String getToken() {
        return token;
    }

    public String getPlatform() {
        return platform;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }
}
