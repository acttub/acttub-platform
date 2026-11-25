package com.acttub.actingapi.feature.coach.schema;

import java.time.Instant;
import java.util.UUID;

import com.acttub.actingapi.platform.schema.AppGeneratedUuidEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/**
 * {@code coach_messages}(V14) — 대화의 턴. 역할은 저장 값 그대로 {@code ai}·{@code actor} 다(화면에는 {@code coach} 로 보인다).
 * 배우 턴만 요청 id 와 지문을 갖는다 — {@code (conversation_id, request_id)} 가 답의 멱등 키다.
 */
@Entity
@Table(name = "coach_messages")
public class CoachMessageEntity extends AppGeneratedUuidEntity {

    @Column(name = "conversation_id", nullable = false)
    UUID conversationId;

    @Column(name = "turn_index", nullable = false)
    int turnIndex;

    @Column(name = "role", nullable = false)
    String role;

    @Column(name = "text", nullable = false)
    String text;

    @Column(name = "request_id")
    UUID requestId;

    // bpchar 이라 JdbcTypeCode 를 함께 준다(PracticeEntity 와 같다).
    @JdbcTypeCode(SqlTypes.CHAR)
    @Column(name = "request_fingerprint", columnDefinition = "char(64)")
    String requestFingerprint;

    @Column(name = "created_at", nullable = false, updatable = false)
    Instant createdAt;

    protected CoachMessageEntity() {
    }

    public CoachMessageEntity(UUID id, UUID conversationId, int turnIndex, String role, String text, Instant now) {
        super(id);
        this.conversationId = conversationId;
        this.turnIndex = turnIndex;
        this.role = role;
        this.text = text;
        this.createdAt = now;
    }
}
