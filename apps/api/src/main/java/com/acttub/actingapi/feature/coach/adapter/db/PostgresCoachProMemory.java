package com.acttub.actingapi.feature.coach.adapter.db;

import com.acttub.actingapi.feature.coach.app.CoachProMemory;
import com.acttub.actingapi.integration.llm.StructuredJson;
import com.acttub.actingapi.platform.persistence.NativeTuples;
import com.fasterxml.jackson.databind.JsonNode;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Tuple;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Repository;

/**
 * Pro 지난 연습 기억 읽기(SOMA-900). 이번 연습과 다른 묶음(root)에서 최근 60일 안에 끝난 코칭의 신형 노트를 최신 순으로 읽는다.
 * 코치 응답은 트랜잭션 밖에서 돌므로 {@code getResultList()}로 다 받아 온다.
 */
@Repository
class PostgresCoachProMemory implements CoachProMemory {
    private final EntityManager entityManager;

    PostgresCoachProMemory(EntityManager entityManager) {
        this.entityManager = entityManager;
    }

    @Override
    public List<Past> recent(UUID userId, UUID practiceId, int limit) {
        if (userId == null || practiceId == null || limit <= 0) return List.of();
        List<Tuple> rows = NativeTuples.list(entityManager.createNativeQuery("""
                SELECT c.closed_at AS at, p.situation, n.title, n.next_take, CAST(n.corrections AS text) AS corrections,
                       (SELECT r.rating FROM note_ratings r WHERE r.note_id=n.id ORDER BY r.created_at DESC LIMIT 1) AS rating
                FROM practices current
                JOIN practices p ON p.user_id=current.user_id AND p.root_id<>current.root_id
                JOIN coach_conversations c ON c.practice_id=p.id AND c.status='closed'
                JOIN coach_notes n ON n.conversation_id=c.id AND n.format='v2'
                WHERE current.id=:practiceId AND current.user_id=:userId
                  AND c.closed_at > now() - interval '60 days'
                  AND (n.title IS NOT NULL OR n.next_take IS NOT NULL)
                ORDER BY c.closed_at DESC
                LIMIT :limit
                """, Tuple.class)
                .setParameter("practiceId", practiceId).setParameter("userId", userId).setParameter("limit", limit));
        List<Past> pasts = new ArrayList<>();
        for (Tuple row : rows) {
            pasts.add(new Past(instant(row.get("at")), row.get("situation", String.class), row.get("title", String.class),
                    row.get("next_take", String.class), corrections(row.get("corrections", String.class)),
                    row.get("rating", String.class)));
        }
        return pasts;
    }

    private static Instant instant(Object value) {
        if (value instanceof Instant instant) return instant;
        if (value instanceof OffsetDateTime time) return time.toInstant();
        if (value instanceof java.sql.Timestamp stamp) return stamp.toInstant();
        return null;
    }

    private static List<String> corrections(String json) {
        if (json == null || json.isBlank()) return List.of();
        try {
            JsonNode node = StructuredJson.MAPPER.readTree(json);
            List<String> out = new ArrayList<>();
            if (node.isArray()) node.forEach(item -> {
                if (item.isTextual() && !item.asText().isBlank()) out.add(item.asText());
            });
            return out;
        } catch (Exception broken) {
            return List.of();
        }
    }
}
