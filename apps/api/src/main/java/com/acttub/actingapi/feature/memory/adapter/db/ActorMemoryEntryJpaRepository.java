package com.acttub.actingapi.feature.memory.adapter.db;

import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.memory.schema.ActorMemoryEntryEntity;
import com.acttub.actingapi.platform.schema.ActorMemoryField;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;

interface ActorMemoryEntryJpaRepository extends Repository<ActorMemoryEntryEntity, UUID> {
    @Query(value = """
            SELECT *
            FROM actor_memory_entries
            WHERE user_id = :userId
            ORDER BY CASE field
                         WHEN 'gender' THEN 1
                         WHEN 'age' THEN 2
                         WHEN 'goal' THEN 3
                         WHEN 'blockage' THEN 4
                         WHEN 'speech_self' THEN 5
                         WHEN 'speech_actual' THEN 6
                     END
            """, nativeQuery = true)
    List<ActorMemoryEntryEntity> findOrderedByUserId(UUID userId);

    @Modifying
    @Query("DELETE FROM ActorMemoryEntryEntity entry WHERE entry.userId = :userId")
    int deleteAllByUserId(UUID userId);

    @Modifying
    @Query("""
            DELETE FROM ActorMemoryEntryEntity entry
            WHERE entry.userId = :userId AND entry.field = :field
            """)
    int deleteFieldByUserId(UUID userId, ActorMemoryField field);
}
