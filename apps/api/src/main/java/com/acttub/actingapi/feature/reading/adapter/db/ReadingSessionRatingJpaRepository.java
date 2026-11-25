package com.acttub.actingapi.feature.reading.adapter.db;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

import com.acttub.actingapi.feature.reading.schema.ReadingSessionRatingEntity;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;

/** {@code reading_session_ratings} 를 읽고 쓰는 문장(apps/api/CONTRACT.md §5-9). */
interface ReadingSessionRatingJpaRepository extends Repository<ReadingSessionRatingEntity, UUID> {

    @Query("select r from ReadingSessionRatingEntity r where r.sessionId = :sessionId and r.userId = :userId")
    Optional<ReadingSessionRatingEntity> find(UUID sessionId, UUID userId);

    /** (회차, 사람)마다 한 행이다. 있으면 평가·한 줄·요청 id·고친 시각을 덮어쓰고 id 와 만든 시각은 처음 것으로 둔다. */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            insert into ReadingSessionRatingEntity (id, sessionId, userId, rating, comment, requestId, createdAt, updatedAt)
            values (:id, :sessionId, :userId, :rating, :comment, :requestId, :now, :now)
            on conflict (sessionId, userId) do update
            set rating = excluded.rating, comment = excluded.comment, requestId = excluded.requestId,
                updatedAt = excluded.updatedAt
            """)
    int upsert(UUID id, UUID sessionId, UUID userId, String rating, String comment, UUID requestId, Instant now);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("delete from ReadingSessionRatingEntity r where r.sessionId = :sessionId")
    int deleteOfSession(UUID sessionId);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("update ReadingSessionRatingEntity r set r.userId = :to where r.userId = :from")
    int reassign(UUID from, UUID to);
}
