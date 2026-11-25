package com.acttub.actingapi.feature.reading.adapter.db;

import java.time.Instant;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;

import com.acttub.actingapi.feature.reading.app.SessionRatingStore;
import com.acttub.actingapi.feature.reading.schema.ReadingSessionRatingEntity;
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
 *
 * <p>{@code users} 는 auth 의 표라 그 잠금만 native SQL 로 둔다(§5-9). 덮어쓴 값은 같은 트랜잭션에서 다시 읽는다.
 */
@Repository
class PostgresSessionRatingStore implements SessionRatingStore {

    private final EntityManager entityManager;
    private final ScriptJpaRepository scripts;
    private final ReadingSessionJpaRepository sessions;
    private final ReadingSessionRatingJpaRepository ratings;
    private final TransactionTemplate transaction;

    PostgresSessionRatingStore(
            EntityManager entityManager,
            ScriptJpaRepository scripts,
            ReadingSessionJpaRepository sessions,
            ReadingSessionRatingJpaRepository ratings,
            PlatformTransactionManager transactionManager) {
        this.entityManager = entityManager;
        this.scripts = scripts;
        this.sessions = sessions;
        this.ratings = ratings;
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
            Optional<UUID> scriptId = sessions.scriptOf(sessionId, userId);
            if (scriptId.isEmpty()) {
                return new Saved(Outcome.SESSION_NOT_FOUND, null);
            }
            scripts.lock(scriptId.get());
            if (sessions.lockOwned(sessionId, userId).isEmpty()) {
                return new Saved(Outcome.SESSION_NOT_FOUND, null);
            }

            Optional<ReadingSessionRatingEntity> existing = ratings.find(sessionId, userId);
            if (existing.isPresent() && requestId.equals(existing.get().getRequestId())) {
                Rating stored = rating(existing.get());
                boolean same = stored.rating().equals(rating) && Objects.equals(stored.comment(), comment);
                return same ? new Saved(Outcome.REPLAYED, stored) : new Saved(Outcome.MISMATCH, null);
            }

            ratings.upsert(UUID.randomUUID(), sessionId, userId, rating, comment, requestId, now);
            return new Saved(Outcome.SAVED, rating(ratings.find(sessionId, userId).orElseThrow()));
        });
    }

    @Override
    public Rating mine(UUID userId, UUID sessionId) {
        return ratings.find(sessionId, userId).map(PostgresSessionRatingStore::rating).orElse(null);
    }

    private static Rating rating(ReadingSessionRatingEntity row) {
        return new Rating(row.getRating(), row.getComment(), row.getUpdatedAt());
    }
}
