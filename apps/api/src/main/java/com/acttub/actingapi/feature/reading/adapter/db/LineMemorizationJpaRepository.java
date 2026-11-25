package com.acttub.actingapi.feature.reading.adapter.db;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import com.acttub.actingapi.feature.reading.schema.LineMemorizationEntity;
import com.acttub.actingapi.platform.schema.MemorizationStatus;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;

/** {@code line_memorization} 을 읽고 쓰는 문장(apps/api/CONTRACT.md §5-9). */
interface LineMemorizationJpaRepository extends Repository<LineMemorizationEntity, UUID> {

    @Query("select m from LineMemorizationEntity m where m.userId = :userId and m.lineId = :lineId")
    Optional<LineMemorizationEntity> find(UUID userId, UUID lineId);

    /** 그 대본의 줄에 이 사람이 남긴 표시, 줄 순서. */
    @Query("""
            select m from LineMemorizationEntity m
            join ScriptLineEntity l on l.id = m.lineId
            where l.scriptId = :scriptId and m.userId = :userId
            order by l.ordinal
            """)
    List<LineMemorizationEntity> ofScript(UUID userId, UUID scriptId);

    /** (사람, 줄)마다 한 행이다. 같은 상태면 고친 시각을 그대로 두고, 다른 상태면 상태와 고친 시각을 바꾼다. */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            insert into LineMemorizationEntity (id, userId, lineId, status, createdAt, updatedAt)
            values (:id, :userId, :lineId, :status, :now, :now)
            on conflict (userId, lineId) do update
            set status = excluded.status,
                updatedAt = case when status = excluded.status then updatedAt else excluded.updatedAt end
            """)
    int upsert(UUID id, UUID userId, UUID lineId, MemorizationStatus status, Instant now);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("update LineMemorizationEntity m set m.userId = :to where m.userId = :from")
    int reassign(UUID from, UUID to);
}
