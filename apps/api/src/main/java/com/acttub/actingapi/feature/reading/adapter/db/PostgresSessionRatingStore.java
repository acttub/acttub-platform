package com.acttub.actingapi.feature.reading.adapter.db;

import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Objects;
import java.util.UUID;

import com.acttub.actingapi.feature.reading.app.SessionRatingStore;
import com.acttub.actingapi.platform.persistence.NativeTuples;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Tuple;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 리딩 회차 평가의 Postgres 구현 — {@code reading_session_ratings} (V40). 노트 평가({@code PostgresNoteRatingStore})와
 * 같은 모양이다.
 *
 * <p><b>쓰기는 탈퇴·이관과 같은 {@code users} 행을 잡고 활성인지 다시 본다</b>(CONTRACT §6-8) — 탈퇴·이관이 끝난 뒤
 * 늦게 온 평가가 닫힌 계정에 남지 않는다. 그다음 <b>대본 행 → 회차 행</b> 순서로 잡는다. 대본 삭제가 대본 행을, 회차
 * 삭제가 회차 행을 잡고 평가를 먼저 지우므로, 겹쳐도 평가가 지워진 회차에 남지 않는다(먼저 온 평가는 함께 지워지고,
 * 늦게 온 평가는 없는 회차를 보고 404 다). 잠금 순서(사람 → 대본 → 회차)는 탈퇴의 리딩 파기와 같다.
 */
@Repository
class PostgresSessionRatingStore implements SessionRatingStore {

    private final EntityManager entityManager;
    private final TransactionTemplate transaction;

    PostgresSessionRatingStore(EntityManager entityManager, PlatformTransactionManager transactionManager) {
        this.entityManager = entityManager;
        this.transaction = new TransactionTemplate(transactionManager);
    }

    @Override
    public Saved save(UUID userId, UUID sessionId, UUID requestId, String rating, String comment, Instant now) {
        return transaction.execute(tx -> {
            if (NativeTuples.list(entityManager.createNativeQuery(
                    "SELECT id FROM users WHERE id=:userId AND status='active' FOR UPDATE", Tuple.class)
                    .setParameter("userId", userId)).isEmpty()) {
                return new Saved(Outcome.INACTIVE, null);
            }
            // 회차 조회와 같은 소유권이다 — 회차의 주인이 이 사람이어야 한다.
            List<Tuple> owned = NativeTuples.list(entityManager.createNativeQuery("""
                    SELECT script_id FROM reading_sessions WHERE id=:sessionId AND user_id=:userId
                    """, Tuple.class)
                    .setParameter("sessionId", sessionId)
                    .setParameter("userId", userId));
            if (owned.isEmpty()) {
                return new Saved(Outcome.SESSION_NOT_FOUND, null);
            }
            NativeTuples.list(entityManager.createNativeQuery(
                    "SELECT id FROM scripts WHERE id=:scriptId FOR UPDATE", Tuple.class)
                    .setParameter("scriptId", owned.getFirst().get("script_id", UUID.class)));
            if (NativeTuples.list(entityManager.createNativeQuery("""
                    SELECT id FROM reading_sessions WHERE id=:sessionId AND user_id=:userId FOR UPDATE
                    """, Tuple.class)
                    .setParameter("sessionId", sessionId)
                    .setParameter("userId", userId)).isEmpty()) {
                return new Saved(Outcome.SESSION_NOT_FOUND, null);
            }

            List<Tuple> existing = NativeTuples.list(entityManager.createNativeQuery("""
                    SELECT rating,comment,request_id,updated_at
                    FROM reading_session_ratings
                    WHERE session_id=:sessionId AND user_id=:userId
                    """, Tuple.class)
                    .setParameter("sessionId", sessionId)
                    .setParameter("userId", userId));
            if (!existing.isEmpty() && requestId.equals(existing.getFirst().get("request_id", UUID.class))) {
                Rating stored = rating(existing.getFirst());
                boolean same = stored.rating().equals(rating) && Objects.equals(stored.comment(), comment);
                return same ? new Saved(Outcome.REPLAYED, stored) : new Saved(Outcome.MISMATCH, null);
            }

            Tuple written = NativeTuples.list(entityManager.createNativeQuery("""
                    WITH written AS (
                        INSERT INTO reading_session_ratings(id,session_id,user_id,rating,comment,request_id,
                                                            created_at,updated_at)
                        VALUES (:id,:sessionId,:userId,:rating,CAST(:comment AS text),:requestId,:now,:now)
                        ON CONFLICT (session_id,user_id) DO UPDATE
                        SET rating=EXCLUDED.rating,
                            comment=EXCLUDED.comment,
                            request_id=EXCLUDED.request_id,
                            updated_at=EXCLUDED.updated_at
                        RETURNING rating,comment,updated_at
                    )
                    SELECT rating,comment,updated_at FROM written
                    """, Tuple.class)
                    .setParameter("id", UUID.randomUUID())
                    .setParameter("sessionId", sessionId)
                    .setParameter("userId", userId)
                    .setParameter("rating", rating)
                    .setParameter("comment", comment)
                    .setParameter("requestId", requestId)
                    .setParameter("now", now.atOffset(ZoneOffset.UTC))).getFirst();
            return new Saved(Outcome.SAVED, rating(written));
        });
    }

    @Override
    public Rating mine(UUID userId, UUID sessionId) {
        List<Tuple> rows = NativeTuples.list(entityManager.createNativeQuery("""
                SELECT rating,comment,updated_at
                FROM reading_session_ratings
                WHERE session_id=:sessionId AND user_id=:userId
                """, Tuple.class)
                .setParameter("sessionId", sessionId)
                .setParameter("userId", userId));
        return rows.isEmpty() ? null : rating(rows.getFirst());
    }

    private static Rating rating(Tuple row) {
        return new Rating(
                row.get("rating", String.class),
                row.get("comment", String.class),
                row.get("updated_at", Instant.class));
    }
}
