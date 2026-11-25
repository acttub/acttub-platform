package com.acttub.actingapi.feature.challenge.adapter.db;

import java.time.Instant;
import java.util.UUID;

import com.acttub.actingapi.feature.challenge.schema.EntryLikeEntity;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;

/** {@code entry_likes} 를 읽고 쓰는 문장(apps/api/CONTRACT.md §5-9). 좋아요 수는 저장하지 않고 이 행을 센다. */
interface EntryLikeJpaRepository extends Repository<EntryLikeEntity, UUID> {

    /** 이미 눌러 둔 좋아요면 0행이다. */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            insert into EntryLikeEntity (id, entryId, userId, createdAt) values (:id, :entryId, :userId, :now)
            on conflict (entryId, userId) do nothing
            """)
    int insertUnlessLiked(UUID id, UUID entryId, UUID userId, Instant now);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("delete from EntryLikeEntity l where l.entryId = :entryId and l.userId = :userId")
    int remove(UUID entryId, UUID userId);

    @Query("select count(*) from EntryLikeEntity l where l.entryId = :entryId")
    long countOf(UUID entryId);
}
