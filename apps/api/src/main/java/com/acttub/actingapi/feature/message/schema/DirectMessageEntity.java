package com.acttub.actingapi.feature.message.schema;

import java.time.Instant;
import java.util.UUID;

import com.acttub.actingapi.platform.schema.AppGeneratedUuidEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;

/** 대화 안의 메시지 한 줄(V105). 글자만이고 {@code (sender_user_id, request_id)} 가 재전송의 열쇠다. */
@Entity
@Table(name = "direct_messages")
public class DirectMessageEntity extends AppGeneratedUuidEntity {

    @Column(name = "conversation_id", nullable = false)
    UUID conversationId;

    @Column(name = "sender_user_id", nullable = false)
    UUID senderUserId;

    @Column(name = "body", nullable = false)
    String body;

    @Column(name = "request_id", nullable = false)
    UUID requestId;

    @Column(name = "request_fingerprint", nullable = false)
    String requestFingerprint;

    @Column(name = "created_at", nullable = false)
    Instant createdAt;

    protected DirectMessageEntity() {
    }

    public DirectMessageEntity(UUID id, UUID conversationId, UUID senderUserId, String body, UUID requestId,
            String requestFingerprint, Instant createdAt) {
        super(id);
        this.conversationId = conversationId;
        this.senderUserId = senderUserId;
        this.body = body;
        this.requestId = requestId;
        this.requestFingerprint = requestFingerprint;
        this.createdAt = createdAt;
    }

    public UUID getConversationId() {
        return conversationId;
    }

    public UUID getSenderUserId() {
        return senderUserId;
    }

    public String getBody() {
        return body;
    }

    public String getRequestFingerprint() {
        return requestFingerprint;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }
}
