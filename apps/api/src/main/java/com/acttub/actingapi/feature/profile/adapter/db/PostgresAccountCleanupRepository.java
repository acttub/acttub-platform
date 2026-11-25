package com.acttub.actingapi.feature.profile.adapter.db;

import static com.acttub.actingapi.platform.persistence.NativeTuples.list;

import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.profile.app.AccountCleanupRepository;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Query;
import jakarta.persistence.Tuple;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 집는 일은 한 문장이다 — {@code FOR UPDATE SKIP LOCKED} 로 고르고 같은 문장에서
 * {@code next_attempt_at} 을 lease 만큼 미룬다. 그래서 두 워커가 같은 행을 함께 집지 못하고, 집은
 * 워커가 죽어도 lease 가 지나면 다시 집힌다 (apps/api/CONTRACT.md §5-2).
 *
 * <p>{@code expires_at} 은 제공자 해제에는 값을 지우는 기한이고, 객체 삭제에는 <b>다음 알림 시각</b>이다 — 객체
 * 삭제는 기한이 지나도 집는다(성공할 때까지 키를 지우지 않는다).
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
        return transaction.execute(status -> claimed(entityManager.createNativeQuery("""
                WITH claimed AS (
                    UPDATE account_cleanup_operations
                    SET attempt_count=attempt_count+1,next_attempt_at=:leasedUntil,updated_at=:now
                    WHERE id IN (SELECT id
                                 FROM account_cleanup_operations
                                 WHERE id IN (:ids)
                                   AND next_attempt_at<=:now
                                   AND (expires_at>:now OR kind IN (:objectKinds))
                                 ORDER BY created_at,id
                                 FOR UPDATE SKIP LOCKED)
                    RETURNING id,user_id,kind,payload_encrypted,attempt_count,created_at
                )
                SELECT id,user_id,kind,payload_encrypted,attempt_count FROM claimed ORDER BY created_at,id
                """, Tuple.class)
                .setParameter("ids", ids)
                .setParameter("objectKinds", OBJECT_DELETE_KINDS)
                .setParameter("now", now.atOffset(ZoneOffset.UTC))
                .setParameter("leasedUntil", now.plus(lease).atOffset(ZoneOffset.UTC))));
    }

    @Override
    public List<CleanupOperation> claimDue(Instant now, int limit, Duration lease) {
        return transaction.execute(status -> claimed(entityManager.createNativeQuery("""
                WITH claimed AS (
                    UPDATE account_cleanup_operations
                    SET attempt_count=attempt_count+1,next_attempt_at=:leasedUntil,updated_at=:now
                    WHERE id IN (SELECT id
                                 FROM account_cleanup_operations
                                 WHERE next_attempt_at<=:now
                                   AND (expires_at>:now OR kind IN (:objectKinds))
                                 ORDER BY next_attempt_at,id
                                 LIMIT :limit
                                 FOR UPDATE SKIP LOCKED)
                    RETURNING id,user_id,kind,payload_encrypted,attempt_count,created_at
                )
                SELECT id,user_id,kind,payload_encrypted,attempt_count FROM claimed ORDER BY created_at,id
                """, Tuple.class)
                .setParameter("objectKinds", OBJECT_DELETE_KINDS)
                .setParameter("now", now.atOffset(ZoneOffset.UTC))
                .setParameter("leasedUntil", now.plus(lease).atOffset(ZoneOffset.UTC))
                .setParameter("limit", limit)));
    }

    @Override
    public void succeeded(UUID id) {
        transaction.executeWithoutResult(status -> commitWithoutFlushForObjectDeletes(kinds(entityManager.createNativeQuery("""
                WITH removed AS (
                    DELETE FROM account_cleanup_operations WHERE id=:id RETURNING kind
                )
                SELECT kind FROM removed
                """, Tuple.class)
                .setParameter("id", id))));
    }

    @Override
    public void failed(UUID id, String error, Instant nextAttemptAt, Instant now) {
        transaction.executeWithoutResult(status -> commitWithoutFlushForObjectDeletes(kinds(entityManager.createNativeQuery("""
                WITH recorded AS (
                    UPDATE account_cleanup_operations
                    SET last_error=:error,next_attempt_at=:nextAttemptAt,updated_at=:now
                    WHERE id=:id
                    RETURNING kind
                )
                SELECT kind FROM recorded
                """, Tuple.class)
                .setParameter("error", error)
                .setParameter("nextAttemptAt", nextAttemptAt.atOffset(ZoneOffset.UTC))
                .setParameter("now", now.atOffset(ZoneOffset.UTC))
                .setParameter("id", id))));
    }

    @Override
    public List<Abandoned> removeExpired(Instant now) {
        return transaction.execute(status -> list(entityManager.createNativeQuery("""
                WITH removed AS (
                    DELETE FROM account_cleanup_operations
                    WHERE expires_at<=:now
                      AND kind NOT IN (:objectKinds)
                    RETURNING id,user_id,kind,attempt_count,last_error
                )
                SELECT id,user_id,kind,attempt_count,last_error FROM removed
                """, Tuple.class)
                .setParameter("objectKinds", OBJECT_DELETE_KINDS)
                .setParameter("now", now.atOffset(ZoneOffset.UTC))).stream()
                .map(row -> new Abandoned(
                        row.get("id", UUID.class),
                        row.get("user_id", UUID.class),
                        row.get("kind", String.class),
                        row.get("attempt_count", Integer.class),
                        row.get("last_error", String.class)))
                .toList());
    }

    @Override
    public List<Overdue> deferOverdueObjectDeletes(Instant now) {
        return transaction.execute(status -> list(entityManager.createNativeQuery("""
                WITH deferred AS (
                    UPDATE account_cleanup_operations
                    SET expires_at=:nextDeadline,updated_at=:now
                    WHERE expires_at<=:now
                      AND kind IN (:objectKinds)
                    RETURNING id,user_id,kind,attempt_count,last_error
                )
                SELECT id,user_id,kind,attempt_count,last_error FROM deferred
                """, Tuple.class)
                .setParameter("objectKinds", OBJECT_DELETE_KINDS)
                .setParameter("now", now.atOffset(ZoneOffset.UTC))
                .setParameter("nextDeadline", now.plus(RETRY_WINDOW).atOffset(ZoneOffset.UTC))).stream()
                .map(row -> new Overdue(
                        row.get("id", UUID.class),
                        row.get("user_id", UUID.class),
                        row.get("kind", String.class),
                        row.get("attempt_count", Integer.class),
                        row.get("last_error", String.class)))
                .toList());
    }

    private List<CleanupOperation> claimed(Query claim) {
        List<CleanupOperation> operations = list(claim).stream()
                .map(PostgresAccountCleanupRepository::operation)
                .toList();
        commitWithoutFlushForObjectDeletes(operations.stream().map(CleanupOperation::kind).toList());
        return operations;
    }

    /**
     * 녹음 덮어쓰기 한 번이 디스크 확정을 기다리는 COMMIT 을 세 번 하던 것을 한 번으로 줄인다(SOMA-1108).
     *
     * <p>서버가 갑자기 꺼지면 마지막 약 0.6초의 장부 변경을 잃고, 정리 작업이 같은 객체를 한 번 더 지운다. 집은 워커가 죽었을
     * 때와 같은 길이고 저장소의 삭제는 다시 해도 결과가 같다. 장부에 행을 넣는 트랜잭션은 그대로 기다리므로 지울 키는 잃지
     * 않는다. 제공자 해제·RevenueCat 삭제는 탈퇴 때만 생겨 아낄 COMMIT 이 적고 카카오 연결 끊기는 두 번째 호출이 성공하는지
     * 모르므로, 하나라도 섞이면 그대로 기다린다.
     *
     * <p>{@code synchronous_commit} 은 COMMIT 때 읽혀서 쓰기 뒤에 걸어도 된다.
     */
    private void commitWithoutFlushForObjectDeletes(List<String> kinds) {
        if (!kinds.isEmpty() && OBJECT_DELETE_KINDS.containsAll(kinds)) {
            entityManager.createNativeQuery("SET LOCAL synchronous_commit = off").executeUpdate();
        }
    }

    private static List<String> kinds(Query written) {
        return list(written).stream().map(row -> row.get("kind", String.class)).toList();
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
