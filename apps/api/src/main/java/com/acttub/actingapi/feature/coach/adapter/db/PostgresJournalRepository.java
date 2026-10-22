package com.acttub.actingapi.feature.coach.adapter.db;

import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;
import java.util.function.UnaryOperator;

import com.acttub.actingapi.feature.coach.app.JournalRepository;
import com.acttub.actingapi.platform.persistence.NativeTuples;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Query;
import jakarta.persistence.Tuple;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 배우 일지의 Postgres 구현 — {@code actor_journals} (V59). native SQL 만 쓴다(Schema Entity 없음).
 *
 * <p>회차마다 한 줄({@code uq_actor_journals_practice})이라 겹친 생성은 {@code ON CONFLICT DO NOTHING} 이 가른다. 읽기·고치기는
 * 늘 {@code user_id} 를 함께 건다 — 남의 일지는 없는 것과 같다.
 */
@Repository
class PostgresJournalRepository implements JournalRepository {

    /**
     * 일지와 화면 머리에 쓸 회차 정보 — 제목(사람·AI 가 붙인 장면 이름), 목적, 배역 이름(AI 가 영상에서 알아본 인물, 없으면 배우가
     * 적은 짧은 인물 칸). 영상 없는 회차의 목적도 저장된 값 그대로다.
     */
    private static final String SELECT = """
            SELECT j.id,j.practice_id,j.conversation_id,j.answers,j.draft,j.draft_status,j.model,j.edited_at,j.created_at,j.updated_at,
                   COALESCE(NULLIF(btrim(p.title),''),NULLIF(btrim(root.title),'')) AS title,
                   p.session_purpose AS purpose,
                   COALESCE(NULLIF(btrim(c.state->'purpose_loop'->'scene'->>'character'),''),
                            CASE WHEN char_length(btrim(p.character_context)) BETWEEN 1 AND 12 THEN btrim(p.character_context) END) AS role_name
            FROM actor_journals j
            JOIN practices p ON p.id=j.practice_id
            JOIN practices root ON root.id=p.root_id
            LEFT JOIN coach_conversations c ON c.id=j.conversation_id
            """;

    private final EntityManager entityManager;
    private final TransactionTemplate transaction;

    PostgresJournalRepository(EntityManager entityManager, PlatformTransactionManager transactionManager) {
        this.entityManager = entityManager;
        this.transaction = new TransactionTemplate(transactionManager);
    }

    @Override
    public Row find(UUID userId, UUID practiceId) {
        return first(NativeTuples.list(entityManager.createNativeQuery(
                SELECT + " WHERE j.practice_id=:practiceId AND j.user_id=:userId", Tuple.class)
                .setParameter("practiceId", practiceId)
                .setParameter("userId", userId)));
    }

    @Override
    public boolean insertPending(UUID id, UUID userId, UUID practiceId, UUID conversationId, String answers, Instant now) {
        return update("""
                INSERT INTO actor_journals(id,user_id,practice_id,conversation_id,answers,draft_status,created_at,updated_at)
                VALUES (:id,:userId,:practiceId,CAST(:conversationId AS uuid),:answers,'pending',:now,:now)
                ON CONFLICT (practice_id) DO NOTHING
                """, q -> q.setParameter("id", id).setParameter("userId", userId).setParameter("practiceId", practiceId)
                .setParameter("conversationId", conversationId).setParameter("answers", answers)
                .setParameter("now", at(now))) == 1;
    }

    @Override
    public void complete(UUID id, String status, String draft, String model, Instant now) {
        update("""
                UPDATE actor_journals
                SET draft_status=:status,draft=CAST(:draft AS text),model=CAST(:model AS text),updated_at=:now
                WHERE id=:id AND draft_status='pending' AND edited_at IS NULL
                """, q -> q.setParameter("id", id).setParameter("status", status).setParameter("draft", draft)
                .setParameter("model", model).setParameter("now", at(now)));
    }

    @Override
    public Row update(UUID userId, UUID practiceId, String answers, String draft, Instant now) {
        int changed = update("""
                UPDATE actor_journals
                SET answers=:answers,draft=:draft,
                    draft_status=CASE WHEN draft_status='pending' THEN 'ready' ELSE draft_status END,
                    edited_at=:now,updated_at=:now
                WHERE practice_id=:practiceId AND user_id=:userId
                """, q -> q.setParameter("practiceId", practiceId).setParameter("userId", userId)
                .setParameter("answers", answers).setParameter("draft", draft).setParameter("now", at(now)));
        return changed == 1 ? find(userId, practiceId) : null;
    }

    private int update(String sql, UnaryOperator<Query> bind) {
        Integer changed = transaction.execute(tx -> bind.apply(entityManager.createNativeQuery(sql)).executeUpdate());
        return changed == null ? 0 : changed;
    }

    private static OffsetDateTime at(Instant instant) {
        return instant.atOffset(ZoneOffset.UTC);
    }

    private static Row first(List<Tuple> rows) {
        if (rows.isEmpty()) {
            return null;
        }
        Tuple row = rows.getFirst();
        return new Row(
                row.get("id", UUID.class),
                row.get("practice_id", UUID.class),
                row.get("conversation_id", UUID.class),
                row.get("answers", String.class),
                row.get("draft", String.class),
                row.get("draft_status", String.class),
                row.get("model", String.class),
                row.get("edited_at", Instant.class),
                row.get("created_at", Instant.class),
                row.get("updated_at", Instant.class),
                row.get("title", String.class),
                row.get("purpose", String.class),
                row.get("role_name", String.class));
    }
}
