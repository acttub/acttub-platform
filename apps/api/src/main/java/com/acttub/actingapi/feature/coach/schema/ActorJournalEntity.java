package com.acttub.actingapi.feature.coach.schema;

import java.time.Instant;
import java.util.UUID;

import com.acttub.actingapi.platform.schema.AppGeneratedUuidEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;

/**
 * {@code actor_journals}(V59) — 배우 일지. 회차마다 한 줄이다({@code uq_actor_journals_practice}). 배우의 답({@code answers})과
 * 자동 칸({@code draft})은 text 칸에 담는 JSON 글이다. 자동 칸의 상태는 DB 값 그대로 문자열이고 CHECK 가 지킨다.
 */
@Entity
@Table(name = "actor_journals")
public class ActorJournalEntity extends AppGeneratedUuidEntity {

    @Column(name = "user_id", nullable = false)
    UUID userId;

    @Column(name = "practice_id", nullable = false)
    UUID practiceId;

    @Column(name = "conversation_id")
    UUID conversationId;

    @Column(name = "answers", nullable = false)
    String answers;

    @Column(name = "draft")
    String draft;

    @Column(name = "draft_status", nullable = false)
    String draftStatus;

    @Column(name = "model")
    String model;

    @Column(name = "edited_at")
    Instant editedAt;

    @Column(name = "created_at", nullable = false, updatable = false)
    Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    Instant updatedAt;

    protected ActorJournalEntity() {
    }

    /** 만드는 중(pending)인 줄. */
    public ActorJournalEntity(UUID id, UUID userId, UUID practiceId, String answers, Instant now) {
        super(id);
        this.userId = userId;
        this.practiceId = practiceId;
        this.answers = answers;
        this.draftStatus = "pending";
        this.createdAt = now;
        this.updatedAt = now;
    }
}
