package com.acttub.actingapi.feature.challenge.adapter.db;

import java.time.Instant;
import java.util.UUID;

import com.acttub.actingapi.feature.challenge.schema.EntryViewEventEntity;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;

/** {@code entry_view_events}(조회수 사건)를 읽고 쓰는 문장(apps/api/CONTRACT.md §5-9). */
interface EntryViewEventJpaRepository extends Repository<EntryViewEventEntity, UUID> {

    /** 이미 반영한 사건이면 0행이다. 함께 넣는 다른 트랜잭션이 있으면 그 커밋을 기다렸다가 판정한다. */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            insert into EntryViewEventEntity (eventId, entryId, userId, createdAt) values (:eventId, :entryId, :userId, :now)
            on conflict (eventId) do nothing
            """)
    int insertUnlessSeen(UUID eventId, UUID entryId, UUID userId, Instant now);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("delete from EntryViewEventEntity v where v.createdAt < :before")
    int deleteOlderThan(Instant before);
}
