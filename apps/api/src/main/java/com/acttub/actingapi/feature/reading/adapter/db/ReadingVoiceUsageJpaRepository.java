package com.acttub.actingapi.feature.reading.adapter.db;

import java.time.LocalDate;
import java.util.UUID;

import com.acttub.actingapi.feature.reading.schema.ReadingVoiceUsageEntity;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;

/**
 * {@code reading_voice_usage} 를 읽는 문장(apps/api/CONTRACT.md §5-9). 줄 수를 올리는 쓰기는 저장 기록과 묶인 CTE 라 저장소의
 * native SQL 에 있다.
 */
interface ReadingVoiceUsageJpaRepository extends Repository<ReadingVoiceUsageEntity, ReadingVoiceUsageEntity.Key> {

    @Query("select coalesce(sum(u.lines), 0) from ReadingVoiceUsageEntity u where u.userId = :userId and u.day = :day")
    long linesOn(UUID userId, LocalDate day);

    /** {@code start} 부터 {@code end} 전까지 모든 사람의 줄 수. */
    @Query("select coalesce(sum(u.lines), 0) from ReadingVoiceUsageEntity u where u.day >= :start and u.day < :end")
    long linesBetween(LocalDate start, LocalDate end);

    @Query("""
            select coalesce(sum(u.lines), 0) from ReadingVoiceUsageEntity u
            where u.userId = :userId and u.day >= :start and u.day < :end
            """)
    long linesBetween(UUID userId, LocalDate start, LocalDate end);
}
