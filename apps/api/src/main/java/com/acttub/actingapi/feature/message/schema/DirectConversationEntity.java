package com.acttub.actingapi.feature.message.schema;

import java.time.Instant;
import java.util.UUID;

import com.acttub.actingapi.platform.schema.AppGeneratedUuidEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;

/**
 * 두 사람 사이의 1:1 대화 한 줄(V105). 먼저 보낸 쪽이 {@code starter} 다. 읽은 시각과 푸시 시각은 참여자마다 칸이 따로 있다.
 */
@Entity
@Table(name = "direct_conversations")
public class DirectConversationEntity extends AppGeneratedUuidEntity {

    @Column(name = "starter_user_id", nullable = false)
    UUID starterUserId;

    @Column(name = "recipient_user_id", nullable = false)
    UUID recipientUserId;

    @Column(name = "origin_post_id")
    UUID originPostId;

    @Column(name = "starter_read_at")
    Instant starterReadAt;

    @Column(name = "recipient_read_at")
    Instant recipientReadAt;

    @Column(name = "starter_pushed_at")
    Instant starterPushedAt;

    @Column(name = "recipient_pushed_at")
    Instant recipientPushedAt;

    @Column(name = "last_message_at")
    Instant lastMessageAt;

    @Column(name = "created_at", nullable = false)
    Instant createdAt;

    protected DirectConversationEntity() {
    }

    public DirectConversationEntity(UUID id, UUID starterUserId, UUID recipientUserId, UUID originPostId, Instant createdAt) {
        super(id);
        this.starterUserId = starterUserId;
        this.recipientUserId = recipientUserId;
        this.originPostId = originPostId;
        this.createdAt = createdAt;
    }

    public UUID getStarterUserId() {
        return starterUserId;
    }

    public UUID getRecipientUserId() {
        return recipientUserId;
    }

    public UUID getOriginPostId() {
        return originPostId;
    }

    public Instant getStarterReadAt() {
        return starterReadAt;
    }

    public Instant getRecipientReadAt() {
        return recipientReadAt;
    }

    public Instant getLastMessageAt() {
        return lastMessageAt;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }
}
