package com.acttub.actingapi.feature.coach.adapter.db;

import java.time.Instant;
import java.util.List;
import java.util.Objects;
import java.util.UUID;

import com.acttub.actingapi.feature.auth.app.AccountRowLock;
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
    private final NoteRatingJpaRepository ratings;
    private final TransactionTemplate transaction;

    private final AccountRowLock accountRows;

    PostgresNoteRatingStore(EntityManager entityManager, NoteRatingJpaRepository ratings,
            PlatformTransactionManager transactionManager,
            AccountRowLock accountRows) {
        this.accountRows = accountRows;
        this.entityManager = entityManager;
        this.ratings = ratings;
        this.transaction = new TransactionTemplate(transactionManager);
    }

    @Override
    public Saved save(UUID userId, UUID practiceId, UUID requestId, String rating, String comment, Instant now) {
        return transaction.execute(tx -> {
            if (!accountRows.lockActive(userId)) {
                return new Saved(Outcome.INACTIVE, null);
            }
            // 노트 조회와 같은 소유권이다 — 회차의 주인이 이 사람이고 그 회차의 대화에 0.1.0 노트가 있어야 한다.
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

            NoteRatingJpaRepository.Existing existing = ratings.existing(noteId, userId).orElse(null);
            if (existing != null && requestId.equals(existing.getRequestId())) {
                Rating stored = rating(existing);
                boolean same = stored.rating().equals(rating) && Objects.equals(stored.comment(), comment);
                return same ? new Saved(Outcome.REPLAYED, stored) : new Saved(Outcome.MISMATCH, null);
            }

            // 넣거나 덮어쓴 줄은 이 트랜잭션이 잡고 있고, 같은 사람의 다른 평가는 위의 사용자 행 잠금에서 기다린다. 다시 읽은 값이 방금 쓴 값이다.
            ratings.upsert(UUID.randomUUID(), practiceId, noteId, userId, rating, comment, requestId, now);
            return new Saved(Outcome.SAVED, rating(ratings.mine(noteId, userId).orElseThrow()));
        });
    }

    @Override
    public Rating mine(UUID userId, UUID noteId) {
        return ratings.mine(noteId, userId).map(PostgresNoteRatingStore::rating).orElse(null);
    }

    private static Rating rating(NoteRatingJpaRepository.Mine row) {
        return new Rating(row.getRating(), row.getComment(), row.getUpdatedAt());
    }

    // --- 이관 ---------------------------------------------------------------

    /**
     * 트랜잭션을 열지 않는다 — 부르는 쪽(이관)의 것에 참여한다. {@code updated_at} 은 배우가 누른 시각이라 두고
     * 주인만 바꾼다.
     */
    @Override
    public void reassign(UUID from, UUID to) {
        ratings.reassign(from, to);
    }
}
