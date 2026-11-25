package com.acttub.actingapi.feature.challenge.adapter.db;

import java.time.Instant;
import java.util.UUID;

import com.acttub.actingapi.feature.challenge.schema.UserBlockEntity;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;

/** {@code user_blocks} 를 읽고 쓰는 문장(apps/api/CONTRACT.md §5-9). 방향마다 한 행이다. */
interface UserBlockJpaRepository extends Repository<UserBlockEntity, UUID> {

    /** 이미 차단했으면 0행이다. */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            insert into UserBlockEntity (id, blockerId, blockedId, createdAt) values (:id, :blockerId, :blockedId, :now)
            on conflict (blockerId, blockedId) do nothing
            """)
    int insertUnlessBlocked(UUID id, UUID blockerId, UUID blockedId, Instant now);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("delete from UserBlockEntity b where b.blockerId = :blockerId and b.blockedId = :blockedId")
    int remove(UUID blockerId, UUID blockedId);
}
