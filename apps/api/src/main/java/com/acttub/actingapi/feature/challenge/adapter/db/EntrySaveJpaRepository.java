package com.acttub.actingapi.feature.challenge.adapter.db;

import java.time.Instant;
import java.util.UUID;

import com.acttub.actingapi.feature.challenge.schema.EntrySaveEntity;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;

/** {@code entry_saves} 를 읽고 쓰는 문장(apps/api/CONTRACT.md §5-9). */
interface EntrySaveJpaRepository extends Repository<EntrySaveEntity, UUID> {

    /** 이미 저장한 참여작이면 0행이다. */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            insert into EntrySaveEntity (id, entryId, userId, createdAt) values (:id, :entryId, :userId, :now)
            on conflict (entryId, userId) do nothing
            """)
    int insertUnlessSaved(UUID id, UUID entryId, UUID userId, Instant now);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("delete from EntrySaveEntity s where s.entryId = :entryId and s.userId = :userId")
    int remove(UUID entryId, UUID userId);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("delete from EntrySaveEntity s where s.entryId = :entryId")
    int removeAllOf(UUID entryId);
}
