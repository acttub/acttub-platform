package com.acttub.actingapi.feature.profile.adapter.db;

import static com.acttub.actingapi.platform.persistence.NativeTuples.list;

import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.profile.app.AccountCleanupRepository;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Tuple;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 집는 일은 한 문장이다 — {@code FOR UPDATE SKIP LOCKED} 로 고르고 같은 문장에서
 * {@code next_attempt_at} 을 lease 만큼 미룬다. 그래서 두 워커가 같은 행을 함께 집지 못하고, 집은
 * 워커가 죽어도 lease 가 지나면 다시 집힌다 (apps/api/CONTRACT.md §5-2).
 */
@Repository
class PostgresAccountCleanupRepository implements AccountCleanupRepository {
    private final EntityManager entityManager;
    private final TransactionTemplate transaction;

    PostgresAccountCleanupRepository(
            EntityManager entityManager,
            PlatformTransactionManager transactionManager) {
        this.entityManager = entityManager;
        this.transaction = new TransactionTemplate(transactionManager);
    }

    @Override
    public List<CleanupOperation> claim(List<UUID> ids, Instant now, Duration lease) {
        if (ids.isEmpty()) {
            return List.of();
        }
        return transaction.execute(status -> list(entityManager.createNativeQuery("""
                WITH claimed AS (
                    UPDATE account_cleanup_operations
                    SET attempt_count=attempt_count+1,next_attempt_at=:leasedUntil,updated_at=:now
                    WHERE id IN (SELECT id
                                 FROM account_cleanup_operations
                                 WHERE id IN (:ids)
                                   AND next_attempt_at<=:now
                                   AND expires_at>:now
                                 ORDER BY created_at,id
                                 FOR UPDATE SKIP LOCKED)
                    RETURNING id,user_id,kind,payload_encrypted,attempt_count,created_at
                )
                SELECT id,user_id,kind,payload_encrypted,attempt_count FROM claimed ORDER BY created_at,id
                """, Tuple.class)
                .setParameter("ids", ids)
                .setParameter("now", now.atOffset(ZoneOffset.UTC))
                .setParameter("leasedUntil", now.plus(lease).atOffset(ZoneOffset.UTC))).stream()
                .map(PostgresAccountCleanupRepository::operation)
                .toList());
    }

    @Override
    public List<CleanupOperation> claimDue(Instant now, int limit, Duration lease) {
        return transaction.execute(status -> list(entityManager.createNativeQuery("""
                WITH claimed AS (
                    UPDATE account_cleanup_operations
                    SET attempt_count=attempt_count+1,next_attempt_at=:leasedUntil,updated_at=:now
                    WHERE id IN (SELECT id
                                 FROM account_cleanup_operations
                                 WHERE next_attempt_at<=:now
                                   AND expires_at>:now
                                 ORDER BY next_attempt_at,id
                                 LIMIT :limit
                                 FOR UPDATE SKIP LOCKED)
                    RETURNING id,user_id,kind,payload_encrypted,attempt_count,created_at
                )
                SELECT id,user_id,kind,payload_encrypted,attempt_count FROM claimed ORDER BY created_at,id
                """, Tuple.class)
                .setParameter("now", now.atOffset(ZoneOffset.UTC))
                .setParameter("leasedUntil", now.plus(lease).atOffset(ZoneOffset.UTC))
                .setParameter("limit", limit)).stream()
                .map(PostgresAccountCleanupRepository::operation)
                .toList());
    }

    @Override
    public void succeeded(UUID id) {
        transaction.executeWithoutResult(status -> entityManager.createNativeQuery(
                "DELETE FROM account_cleanup_operations WHERE id=:id")
                .setParameter("id", id)
                .executeUpdate());
    }

    @Override
    public void failed(UUID id, String error, Instant nextAttemptAt, Instant now) {
        transaction.executeWithoutResult(status -> entityManager.createNativeQuery("""
                UPDATE account_cleanup_operations
                SET last_error=:error,next_attempt_at=:nextAttemptAt,updated_at=:now
                WHERE id=:id
                """)
                .setParameter("error", error)
                .setParameter("nextAttemptAt", nextAttemptAt.atOffset(ZoneOffset.UTC))
                .setParameter("now", now.atOffset(ZoneOffset.UTC))
                .setParameter("id", id)
                .executeUpdate());
    }

    @Override
    public List<Abandoned> removeExpired(Instant now) {
        return transaction.execute(status -> list(entityManager.createNativeQuery("""
                WITH removed AS (
                    DELETE FROM account_cleanup_operations
                    WHERE expires_at<=:now
                    RETURNING id,user_id,kind,attempt_count,last_error
                )
                SELECT id,user_id,kind,attempt_count,last_error FROM removed
                """, Tuple.class)
                .setParameter("now", now.atOffset(ZoneOffset.UTC))).stream()
                .map(row -> new Abandoned(
                        row.get("id", UUID.class),
                        row.get("user_id", UUID.class),
                        row.get("kind", String.class),
                        row.get("attempt_count", Integer.class),
                        row.get("last_error", String.class)))
                .toList());
    }

    private static CleanupOperation operation(Tuple row) {
        return new CleanupOperation(
                row.get("id", UUID.class),
                row.get("user_id", UUID.class),
                row.get("kind", String.class),
                row.get("payload_encrypted", String.class),
                row.get("attempt_count", Integer.class));
    }
}
