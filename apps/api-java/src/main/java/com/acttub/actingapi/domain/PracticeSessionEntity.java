package com.acttub.actingapi.domain;

import java.time.Instant;
import java.util.UUID;

import jakarta.persistence.Column;
import jakarta.persistence.Convert;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Transient;
import org.hibernate.annotations.JdbcType;
import org.springframework.data.domain.Persistable;

/**
 * {@code practice_sessions} — 부분 인덱스
 * {@code idx_practice_sessions_user_visible_created ... WHERE hidden_at IS NULL} 가 걸려 있어
 * {@code ddl-auto: validate} 가 부분 인덱스를 어떻게 다루는지 확인하는 대상이다 (/SPEC.md §5-3-6).
 *
 * <p>{@code user_id}/{@code upload_intent_id} 는 FK 컬럼을 UUID 로만 들고 있는다 — 관계 매핑 금지.
 */
@Entity
@Table(name = "practice_sessions")
public class PracticeSessionEntity implements Persistable<UUID> {

    @Id
    @Column(name = "id", nullable = false)
    private UUID id;

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Column(name = "upload_intent_id", nullable = false)
    private UUID uploadIntentId;

    @Convert(converter = PracticeStatus.JpaConverter.class)
    @JdbcType(PgEnumJdbcType.class)
    @Column(name = "status", nullable = false, columnDefinition = "practice_status_t")
    private PracticeStatus status;

    @Column(name = "situation", nullable = false)
    private String situation;

    @Column(name = "character_context", nullable = false)
    private String characterContext;

    @Column(name = "subtext", nullable = false)
    private String subtext;

    @Column(name = "hidden_at")
    private Instant hiddenAt;

    @Column(name = "created_at", nullable = false, insertable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false, insertable = false, updatable = false)
    private Instant updatedAt;

    @Transient
    private boolean isNew = true;

    protected PracticeSessionEntity() {
    }

    public PracticeSessionEntity(UUID id, UUID userId, UUID uploadIntentId, PracticeStatus status,
            String situation, String characterContext, String subtext) {
        this.id = id;
        this.userId = userId;
        this.uploadIntentId = uploadIntentId;
        this.status = status;
        this.situation = situation;
        this.characterContext = characterContext;
        this.subtext = subtext;
    }

    @Override
    public UUID getId() {
        return id;
    }

    @Override
    public boolean isNew() {
        return isNew;
    }

    @jakarta.persistence.PostPersist
    @jakarta.persistence.PostLoad
    void markNotNew() {
        this.isNew = false;
    }

    public UUID getUserId() {
        return userId;
    }

    public UUID getUploadIntentId() {
        return uploadIntentId;
    }

    public PracticeStatus getStatus() {
        return status;
    }

    public String getSituation() {
        return situation;
    }

    public String getCharacterContext() {
        return characterContext;
    }

    public String getSubtext() {
        return subtext;
    }

    public Instant getHiddenAt() {
        return hiddenAt;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }
}
