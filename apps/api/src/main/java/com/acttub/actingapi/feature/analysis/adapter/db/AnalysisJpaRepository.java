package com.acttub.actingapi.feature.analysis.adapter.db;

import java.time.Instant;
import java.util.UUID;

import com.acttub.actingapi.feature.analysis.schema.AnalysisEntity;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;
import tools.jackson.databind.JsonNode;

/** {@code analyses} 를 쓰는 문장(apps/api/CONTRACT.md §5-9). */
interface AnalysisJpaRepository extends Repository<AnalysisEntity, UUID> {

    /** 회차에 기록이 이미 있으면 덮지 않는다({@code uq_analyses_practice}) — 완료 뒤 불변이다. */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            insert into AnalysisEntity (id, practiceId, format, status, model, record, createdAt, completedAt)
            values (:id, :practiceId, :format, :status, :model, :record, :now, :now)
            on conflict (practiceId) do nothing
            """)
    int insertUnlessRecorded(UUID id, UUID practiceId, String format, String status, String model, JsonNode record,
            Instant now);
}
