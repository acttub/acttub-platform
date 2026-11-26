package com.acttub.actingapi.feature.reading.schema;

import java.time.Instant;
import java.util.UUID;

import com.acttub.actingapi.platform.schema.AppGeneratedUuidEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;

/**
 * {@code reading_session_ratings}(V40) — 회차 하나에 사람 하나가 남기는 평가 (reading.session).
 *
 * <p>(session_id, user_id) 가 유일하고 다시 남기면 같은 행을 덮어쓴다. {@code rating} 은 DB 값이자 API 값이라 문자열 그대로
 * 둔다(허용 값은 DB 의 CHECK 가 지킨다). {@code request_id} 는 마지막으로 반영한 요청이다.
 */
@Entity
@Table(name = "reading_session_ratings")
public class ReadingSessionRatingEntity extends AppGeneratedUuidEntity {

    @Column(name = "session_id", nullable = false)
    private UUID sessionId;

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Column(name = "rating", nullable = false)
    private String rating;

    @Column(name = "comment")
    private String comment;

    @Column(name = "request_id", nullable = false)
    private UUID requestId;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    protected ReadingSessionRatingEntity() {
    }

    public ReadingSessionRatingEntity(
            UUID id, UUID sessionId, UUID userId, String rating, String comment, UUID requestId, Instant createdAt,
            Instant updatedAt) {
        super(id);
        this.sessionId = sessionId;
        this.userId = userId;
        this.rating = rating;
        this.comment = comment;
        this.requestId = requestId;
        this.createdAt = createdAt;
        this.updatedAt = updatedAt;
    }

    public String getRating() {
        return rating;
    }

    public String getComment() {
        return comment;
    }

    public UUID getRequestId() {
        return requestId;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }
}
