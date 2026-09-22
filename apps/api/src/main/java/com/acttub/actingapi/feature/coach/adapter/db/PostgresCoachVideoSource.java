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
        var practices = com.acttub.actingapi.platform.persistence.NativeTuples.list(
                entityManager.createNativeQuery("""
                    SELECT p.user_id,v.object_key,v.content_type,v.purged_at,
                           (SELECT u.etag FROM upload_intents u WHERE u.video_id=v.id
                            ORDER BY u.finalized_at DESC LIMIT 1) AS etag
                    FROM practices p LEFT JOIN videos v ON v.id=p.video_id AND v.user_id=p.user_id
                    WHERE p.id=:practice
                    """, Tuple.class).setParameter("practice", practiceSessionId));
        if (!practices.isEmpty()) {
            var row = practices.getFirst();
            // 새 표가 있으면 그 소유권·파일 파기 상태가 정본이다. 옛 업로드로 되돌아가 재생하지 않는다.
            if (!userId.equals(row.get("user_id", UUID.class)) || row.get("object_key") == null
                    || row.get("purged_at") != null) return null;
            return new Video(row.get("object_key", String.class), row.get("content_type", String.class),
                    row.get("etag", String.class));
        }
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
