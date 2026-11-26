package com.acttub.actingapi.feature.coach.adapter.db;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

import com.acttub.actingapi.feature.coach.schema.NoteRatingEntity;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;

/** {@code note_ratings} 한 표만 읽고 쓰는 문장. 사용자 행 잠금과 회차로 노트를 찾는 조회는 {@link PostgresNoteRatingStore} 의 native 다. */
interface NoteRatingJpaRepository extends Repository<NoteRatingEntity, UUID> {

    /** 그 노트에 이 사람이 남긴 평가. 노트 읽기에 실린다. */
    @Query("""
            select r.rating as rating, r.comment as comment, r.updatedAt as updatedAt
            from NoteRatingEntity r
            where r.noteId = :noteId and r.userId = :userId
            """)
    Optional<Mine> mine(UUID noteId, UUID userId);

    interface Mine {
        String getRating();

        String getComment();

        Instant getUpdatedAt();
    }

    /** 멱등 판정에 쓰는 지금 줄 — 마지막으로 반영한 요청 id 를 함께 읽는다. */
    @Query("""
            select r.rating as rating, r.comment as comment, r.requestId as requestId, r.updatedAt as updatedAt
            from NoteRatingEntity r
            where r.noteId = :noteId and r.userId = :userId
            """)
    Optional<Existing> existing(UUID noteId, UUID userId);

    interface Existing extends Mine {
        UUID getRequestId();
    }

    /** 처음이면 넣고, 있으면 값·한 줄·요청 id·고친 시각을 덮어쓴다(id 와 만든 시각은 그대로). */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            insert into NoteRatingEntity (id, practiceId, noteId, userId, rating, comment, requestId, createdAt, updatedAt)
            values (:id, :practiceId, :noteId, :userId, :rating, :comment, :requestId, :now, :now)
            on conflict (noteId, userId) do update set
                rating = excluded.rating, comment = excluded.comment, requestId = excluded.requestId,
                updatedAt = excluded.updatedAt
            """)
    int upsert(UUID id, UUID practiceId, UUID noteId, UUID userId, String rating, String comment, UUID requestId, Instant now);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("update NoteRatingEntity r set r.userId = :to where r.userId = :from")
    int reassign(UUID from, UUID to);
}
