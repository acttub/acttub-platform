package com.acttub.actingapi.feature.coach.adapter.db;

import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Objects;
import java.util.UUID;

import com.acttub.actingapi.feature.coach.app.NoteRatingOwnership;
import com.acttub.actingapi.feature.coach.app.NoteRatingStore;
import com.acttub.actingapi.platform.persistence.NativeTuples;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Tuple;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 노트 평가의 Postgres 구현 — {@code note_ratings} (V22).
 *
 * <p><b>쓰기는 탈퇴와 같은 {@code users} 행을 잡고 활성인지 다시 본다</b>(CONTRACT §6-8) — 탈퇴가 한 줄을 비운 뒤에
 * 늦게 온 평가가 한 줄을 되살리지 못한다. 같은 사람의 평가도 이 잠금에서 줄을 서므로 멱등 판정(행의
 * {@code request_id} 와 값을 견주기)과 덮어쓰기 사이에 끼어드는 것이 없다.
 */
@Repository
class PostgresNoteRatingStore implements NoteRatingStore, NoteRatingOwnership {

    private final EntityManager entityManager;
    private final TransactionTemplate transaction;

    PostgresNoteRatingStore(EntityManager entityManager, PlatformTransactionManager transactionManager) {
        this.entityManager = entityManager;
        this.transaction = new TransactionTemplate(transactionManager);
    }

    @Override
    public Saved save(UUID userId, UUID practiceId, UUID requestId, String rating, String comment, Instant now) {
        return transaction.execute(tx -> {
            if (NativeTuples.list(entityManager.createNativeQuery(
                    "SELECT id FROM users WHERE id=:userId AND status='active' FOR UPDATE", Tuple.class)
                    .setParameter("userId", userId)).isEmpty()) {
                return new Saved(Outcome.INACTIVE, null);
            }
            // 노트 조회와 같은 소유권이다 — 회차의 주인이 이 사람이고 그 회차의 대화에 1.0.0 노트가 있어야 한다.
            List<Tuple> notes = NativeTuples.list(entityManager.createNativeQuery("""
                    SELECT n.id
                    FROM practices p
                    JOIN coach_conversations c ON c.practice_id=p.id
                    JOIN coach_notes n ON n.conversation_id=c.id
                    WHERE p.id=:practiceId AND p.user_id=:userId
                    """, Tuple.class)
                    .setParameter("practiceId", practiceId)
                    .setParameter("userId", userId));
            if (notes.isEmpty()) {
                return new Saved(Outcome.NOTE_NOT_FOUND, null);
            }
            UUID noteId = notes.getFirst().get("id", UUID.class);

            List<Tuple> existing = NativeTuples.list(entityManager.createNativeQuery("""
                    SELECT rating,comment,request_id,updated_at
                    FROM note_ratings
                    WHERE note_id=:noteId AND user_id=:userId
                    """, Tuple.class)
                    .setParameter("noteId", noteId)
                    .setParameter("userId", userId));
            if (!existing.isEmpty() && requestId.equals(existing.getFirst().get("request_id", UUID.class))) {
                Rating stored = rating(existing.getFirst());
                boolean same = stored.rating().equals(rating) && Objects.equals(stored.comment(), comment);
                return same ? new Saved(Outcome.REPLAYED, stored) : new Saved(Outcome.MISMATCH, null);
            }

            Tuple written = NativeTuples.list(entityManager.createNativeQuery("""
                    WITH written AS (
                        INSERT INTO note_ratings(id,practice_id,note_id,user_id,rating,comment,request_id,
                                                 created_at,updated_at)
                        VALUES (:id,:practiceId,:noteId,:userId,:rating,CAST(:comment AS text),:requestId,:now,:now)
                        ON CONFLICT (note_id,user_id) DO UPDATE
                        SET rating=EXCLUDED.rating,
                            comment=EXCLUDED.comment,
                            request_id=EXCLUDED.request_id,
                            updated_at=EXCLUDED.updated_at
                        RETURNING rating,comment,updated_at
                    )
                    SELECT rating,comment,updated_at FROM written
                    """, Tuple.class)
                    .setParameter("id", UUID.randomUUID())
                    .setParameter("practiceId", practiceId)
                    .setParameter("noteId", noteId)
                    .setParameter("userId", userId)
                    .setParameter("rating", rating)
                    .setParameter("comment", comment)
                    .setParameter("requestId", requestId)
                    .setParameter("now", now.atOffset(ZoneOffset.UTC))).getFirst();
            return new Saved(Outcome.SAVED, rating(written));
        });
    }

    @Override
    public Rating mine(UUID userId, UUID noteId) {
        List<Tuple> rows = NativeTuples.list(entityManager.createNativeQuery("""
                SELECT rating,comment,updated_at
                FROM note_ratings
                WHERE note_id=:noteId AND user_id=:userId
                """, Tuple.class)
                .setParameter("noteId", noteId)
                .setParameter("userId", userId));
        return rows.isEmpty() ? null : rating(rows.getFirst());
    }

    private static Rating rating(Tuple row) {
        return new Rating(
                row.get("rating", String.class),
                row.get("comment", String.class),
                row.get("updated_at", Instant.class));
    }

    // --- 이관 ---------------------------------------------------------------

    /**
     * 트랜잭션을 열지 않는다 — 부르는 쪽(이관)의 것에 참여한다. {@code updated_at} 은 배우가 누른 시각이라 두고
     * 주인만 바꾼다.
     */
    @Override
    public void reassign(UUID from, UUID to) {
        entityManager.createNativeQuery("""
                UPDATE note_ratings SET user_id=:to WHERE user_id=:from
                """)
                .setParameter("to", to)
                .setParameter("from", from)
                .executeUpdate();
    }
}
