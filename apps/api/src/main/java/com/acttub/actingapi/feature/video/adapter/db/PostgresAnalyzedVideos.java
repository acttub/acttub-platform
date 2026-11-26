package com.acttub.actingapi.feature.video.adapter.db;

import java.time.Instant;
import java.util.UUID;

import com.acttub.actingapi.feature.video.app.AnalyzedVideos;
import jakarta.persistence.EntityManager;
import org.springframework.stereotype.Repository;
import tools.jackson.databind.JsonNode;

/** 트랜잭션을 열지 않는다 — 분석 결과를 저장하는 트랜잭션에 참여한다. */
@Repository
class PostgresAnalyzedVideos implements AnalyzedVideos {

    private final EntityManager entityManager;

    PostgresAnalyzedVideos(EntityManager entityManager) {
        this.entityManager = entityManager;
    }

    @Override
    public void recordDuration(UUID videoId, int durationMs, Instant now) {
        entityManager.createQuery("""
                        update VideoEntity v
                        set v.durationMs = :durationMs, v.updatedAt = :now
                        where v.id = :videoId and v.durationMs = 0
                        """)
                .setParameter("durationMs", durationMs)
                .setParameter("now", now)
                .setParameter("videoId", videoId)
                .executeUpdate();
    }

    /** {@code uq_video_transcripts_video} 가 영상당 하나를 보장한다. 이미 있으면 0행이다. */
    @Override
    public void keepTranscript(UUID videoId, JsonNode segments, Instant now) {
        entityManager.createQuery("""
                        insert into VideoTranscriptEntity (id, videoId, status, source, segments, createdAt, updatedAt, completedAt)
                        values (:id, :videoId, 'ready', 'stt', :segments, :now, :now, :now)
                        on conflict (videoId) do nothing
                        """)
                .setParameter("id", UUID.randomUUID())
                .setParameter("videoId", videoId)
                .setParameter("segments", segments)
                .setParameter("now", now)
                .executeUpdate();
    }
}
