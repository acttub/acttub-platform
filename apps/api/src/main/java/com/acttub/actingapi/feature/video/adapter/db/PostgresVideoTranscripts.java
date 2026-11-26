package com.acttub.actingapi.feature.video.adapter.db;

import java.util.Optional;
import java.util.UUID;

import com.acttub.actingapi.feature.video.app.VideoTranscripts;
import jakarta.persistence.EntityManager;
import org.springframework.stereotype.Repository;
import tools.jackson.databind.JsonNode;

@Repository
class PostgresVideoTranscripts implements VideoTranscripts {

    private final EntityManager entityManager;

    PostgresVideoTranscripts(EntityManager entityManager) {
        this.entityManager = entityManager;
    }

    @Override
    public Optional<JsonNode> readySegments(UUID videoId) {
        return entityManager.createQuery(
                        "select t.segments from VideoTranscriptEntity t where t.videoId = :videoId and t.status = 'ready'",
                        JsonNode.class)
                .setParameter("videoId", videoId)
                .getResultList().stream().findFirst();
    }
}
