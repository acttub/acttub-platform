package com.acttub.actingapi.feature.coach.adapter.db;

import java.util.UUID;
import com.acttub.actingapi.feature.coach.app.CoachVideoSource;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Tuple;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

@Repository
public class PostgresCoachVideoSource implements CoachVideoSource {
    private final EntityManager entityManager;

    public PostgresCoachVideoSource(EntityManager entityManager) {
        this.entityManager = entityManager;
    }

    @Override
    @Transactional(readOnly = true)
    public Video find(UUID userId, UUID practiceSessionId) {
        var rows = com.acttub.actingapi.platform.persistence.NativeTuples.list(
                entityManager.createNativeQuery("""
                    SELECT ui.object_key, ui.mime_type, ui.etag
                    FROM practice_sessions ps
                    JOIN upload_intents ui ON ui.id = ps.upload_intent_id
                    WHERE ps.id = :session AND ps.user_id = :owner AND ps.hidden_at IS NULL
                    """, Tuple.class)
                    .setParameter("session", practiceSessionId).setParameter("owner", userId));
        if (rows.isEmpty()) return null;
        var row = rows.getFirst();
        return new Video(row.get("object_key", String.class), row.get("mime_type", String.class),
                row.get("etag", String.class));
    }
}
