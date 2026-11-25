package com.acttub.actingapi.feature.coach.adapter.db;

import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.function.IntSupplier;

import com.acttub.actingapi.feature.coach.app.JournalRepository;
import com.acttub.actingapi.platform.persistence.NativeTuples;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Tuple;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 배우 일지의 Postgres 구현 — {@code actor_journals} (V59). 쓰기는 {@link ActorJournalJpaRepository} 의 HQL 한 문장씩이고,
 * 화면 머리(제목·목적·배역)를 함께 읽는 조회만 native 다.
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
            SELECT j.id,j.practice_id,j.conversation_id,j.answers,j.draft,
                   -- 옛 서버가 대화 없는 일지에 쓰던 skipped 는 ready 로 읽는다. 배포가 겹치는 동안 옛 서버가 쓴 행도 읽게 남기고,
                   -- CHECK 에서 skipped 를 빼는 다음 배포에서 이 줄도 지운다(SOMA-1130).
                   CASE WHEN j.draft_status='skipped' THEN 'ready' ELSE j.draft_status END AS draft_status,
                   j.model,j.edited_at,j.created_at,j.updated_at,
                   COALESCE(NULLIF(btrim(p.title),''),NULLIF(btrim(root.title),'')) AS title,
                   p.session_purpose AS purpose,
                   COALESCE(NULLIF(btrim(c.state->'purpose_loop'->'scene'->>'character'),''),
                            CASE WHEN char_length(btrim(p.character_context)) BETWEEN 1 AND 12 THEN btrim(p.character_context) END) AS role_name,
                   NULLIF(btrim(up.name),'') AS actor_name,NULLIF(btrim(u.nickname),'') AS actor_nickname
            FROM actor_journals j
            JOIN practices p ON p.id=j.practice_id
            JOIN practices root ON root.id=p.root_id
            LEFT JOIN coach_conversations c ON c.id=j.conversation_id
            LEFT JOIN users u ON u.id=j.user_id
            LEFT JOIN user_profiles up ON up.user_id=j.user_id
            """;

    /**
     * 배역 이름이 배우 자신의 이름이면 배역을 모르는 것으로 본다 — 영상에서 인물을 못 알아본 AI 가 배우 이름을 인물 칸에 넣어
     * 일지 머리가 「WooYoung 역」으로 보였다(10/28 dev).
     */
    static String roleOrNull(String role, String actorName, String actorNickname) {
        if (role == null || role.isBlank()) return null;
        String r = role.strip();
        if (actorName != null && r.equalsIgnoreCase(actorName.strip())) return null;
        if (actorNickname != null && r.equalsIgnoreCase(actorNickname.strip())) return null;
        return r;
    }

    private final EntityManager entityManager;
    private final ActorJournalJpaRepository journals;
    private final TransactionTemplate transaction;

    PostgresJournalRepository(EntityManager entityManager, ActorJournalJpaRepository journals,
            PlatformTransactionManager transactionManager) {
        this.entityManager = entityManager;
        this.journals = journals;
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
        return changed(() -> journals.insertPending(id, userId, practiceId, conversationId, answers, now)) == 1;
    }

    @Override
    public void complete(UUID id, String status, String draft, String model, Instant now) {
        changed(() -> journals.complete(id, status, draft, model, now));
    }

    @Override
    public Row update(UUID userId, UUID practiceId, String answers, String draft, Instant now) {
        return changed(() -> journals.edit(userId, practiceId, answers, draft, now)) == 1 ? find(userId, practiceId) : null;
    }

    /** 쓰기 한 문장을 제 트랜잭션에서 돌린다(부르는 쪽이 열어 둔 것이 있으면 거기에 참여한다). */
    private int changed(IntSupplier write) {
        Integer changed = transaction.execute(tx -> write.getAsInt());
        return changed == null ? 0 : changed;
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
                roleOrNull(row.get("role_name", String.class), row.get("actor_name", String.class), row.get("actor_nickname", String.class)));
    }
}
