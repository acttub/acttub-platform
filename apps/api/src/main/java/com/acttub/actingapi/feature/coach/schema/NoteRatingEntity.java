package com.acttub.actingapi.feature.coach.schema;

import java.time.Instant;
import java.util.UUID;

import com.acttub.actingapi.platform.schema.AppGeneratedUuidEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;

/**
 * {@code note_ratings}(V22) — 노트 하나에 사람 하나가 남기는 평가({@code (note_id, user_id)} 가 유일하다). 다시 누르면 같은 줄을
 * 덮어쓴다. {@code request_id} 는 마지막으로 반영한 요청이다. 값은 DB 값 그대로 문자열이고 CHECK 가 지킨다.
 */
@Entity
@Table(name = "note_ratings")
public class NoteRatingEntity extends AppGeneratedUuidEntity {

    @Column(name = "practice_id", nullable = false)
    UUID practiceId;

    @Column(name = "note_id", nullable = false)
    UUID noteId;

    @Column(name = "user_id", nullable = false)
    UUID userId;

    @Column(name = "rating", nullable = false)
    String rating;

    @Column(name = "comment")
    String comment;

    @Column(name = "request_id", nullable = false)
    UUID requestId;

    @Column(name = "created_at", nullable = false, updatable = false)
    Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    Instant updatedAt;

    protected NoteRatingEntity() {
    }

    public NoteRatingEntity(UUID id, UUID practiceId, UUID noteId, UUID userId, String rating, UUID requestId, Instant now) {
        super(id);
        this.practiceId = practiceId;
        this.noteId = noteId;
        this.userId = userId;
        this.rating = rating;
        this.requestId = requestId;
        this.createdAt = now;
        this.updatedAt = now;
    }
}
