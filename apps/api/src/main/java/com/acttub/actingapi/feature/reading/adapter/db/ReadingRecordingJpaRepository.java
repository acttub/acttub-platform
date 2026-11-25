package com.acttub.actingapi.feature.reading.adapter.db;

import java.util.UUID;

import com.acttub.actingapi.feature.reading.schema.ReadingRecordingEntity;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;

/** {@code reading_recordings} 를 읽고 쓰는 문장(apps/api/CONTRACT.md §5-9). */
interface ReadingRecordingJpaRepository extends Repository<ReadingRecordingEntity, UUID> {

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("update ReadingRecordingEntity r set r.userId = :to where r.userId = :from")
    int reassign(UUID from, UUID to);
}
