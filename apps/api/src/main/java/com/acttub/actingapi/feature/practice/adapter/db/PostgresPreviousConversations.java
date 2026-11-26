package com.acttub.actingapi.feature.practice.adapter.db;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.practice.app.PracticeViews.PreviousConversation;
import com.acttub.actingapi.feature.practice.app.PreviousConversations;
import com.acttub.actingapi.platform.persistence.NativeTuples;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Tuple;
import org.springframework.stereotype.Repository;

/**
 * 옛 {@code coach_sessions} 에 남은 이전 대화를 읽는다. 상태는 늘 {@code closed} 로 낸다 — 답·이어 하기는 새 표만
 * 보므로 옛 표의 대화에는 이어 말할 수 없다(specs/practice 「0.1.0 스키마 전환」).
 */
@Repository
class PostgresPreviousConversations implements PreviousConversations {

    private final EntityManager entityManager;

    PostgresPreviousConversations(EntityManager entityManager) {
        this.entityManager = entityManager;
    }

    @Override
    public List<PreviousConversation> of(UUID userId, UUID practiceId) {
        return NativeTuples.list(entityManager.createNativeQuery("""
                SELECT cs.id,'closed' AS status,cs.created_at
                FROM coach_sessions cs
                JOIN practice_sessions ps ON ps.id=cs.practice_session_id
                WHERE cs.practice_session_id=:practiceId
                  AND ps.user_id=:userId
                  AND cs.id <> (SELECT newest.id FROM coach_sessions newest
                                WHERE newest.practice_session_id=:practiceId
                                ORDER BY newest.created_at DESC,newest.id DESC LIMIT 1)
                ORDER BY cs.created_at DESC,cs.id DESC
                """, Tuple.class)
                .setParameter("practiceId", practiceId)
                .setParameter("userId", userId)).stream()
                .map(row -> new PreviousConversation(
                        row.get("id", UUID.class),
                        row.get("status", String.class),
                        row.get("created_at", Instant.class)))
                .toList();
    }
}
