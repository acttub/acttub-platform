package com.acttub.actingapi.feature.ads.adapter.db;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

import com.acttub.actingapi.feature.ads.schema.AdSettingsEntity;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;

/** 빈도 상한의 {@code ad_settings}(한 줄)·{@code ad_serves} 를 읽고 쓰는 문장(apps/api/CONTRACT.md §5-9). */
interface AdFrequencyJpaRepository extends Repository<AdSettingsEntity, Integer> {

    @Query("select s from AdSettingsEntity s where s.id = 1")
    Optional<AdSettingsEntity> settings();

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            insert into AdSettingsEntity (id, windowMinutes, windowCap, firstDayCap, updatedAt)
            values (1, :minutes, :cap, :firstDay, :now)
            on conflict (id) do update
            set windowMinutes = excluded.windowMinutes, windowCap = excluded.windowCap,
                firstDayCap = excluded.firstDayCap, updatedAt = excluded.updatedAt
            """)
    int upsertSettings(int minutes, int cap, int firstDay, Instant now);

    @Query("select count(*) from AdServeEntity s where s.userId = :userId and s.servedAt > :since")
    long servedSince(UUID userId, Instant since);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("insert into AdServeEntity (id, userId, servedAt) values (:id, :userId, :at)")
    int insertServe(UUID id, UUID userId, Instant at);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("delete from AdServeEntity s where s.servedAt < :before")
    int purgeBefore(Instant before);
}
