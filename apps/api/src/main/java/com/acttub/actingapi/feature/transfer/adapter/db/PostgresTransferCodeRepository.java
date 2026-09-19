package com.acttub.actingapi.feature.transfer.adapter.db;

import static com.acttub.actingapi.platform.persistence.NativeTuples.list;

import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;
import java.util.function.Supplier;

import com.acttub.actingapi.feature.transfer.app.TransferCodeRepository;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Tuple;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

@Repository
class PostgresTransferCodeRepository implements TransferCodeRepository {
    private final EntityManager entityManager;
    private final TransactionTemplate transaction;

    PostgresTransferCodeRepository(EntityManager entityManager, PlatformTransactionManager transactionManager) {
        this.entityManager = entityManager;
        this.transaction = new TransactionTemplate(transactionManager);
    }

    @Override
    public boolean issue(UUID guestId, String codeHash, Instant now, Instant expiresAt) {
        return Boolean.TRUE.equals(transaction.execute(status -> {
            boolean taken = !list(entityManager.createNativeQuery("""
                    SELECT 1 AS taken
                    FROM guest_transfer_codes
                    WHERE code_hash=:codeHash
                      AND user_id<>:guestId
                      AND used_at IS NULL
                      AND expires_at>:now
                    LIMIT 1
                    """, Tuple.class)
                    .setParameter("codeHash", codeHash)
                    .setParameter("guestId", guestId)
                    .setParameter("now", now.atOffset(ZoneOffset.UTC))).isEmpty();
            if (taken) {
                return false;
            }
            // 새로 받으면 이전 코드는 무효다. 쓰인 코드는 "옮겨졌다"는 표식이라 남긴다.
            entityManager.createNativeQuery("""
                    DELETE FROM guest_transfer_codes
                    WHERE user_id=:guestId
                      AND used_at IS NULL
                    """)
                    .setParameter("guestId", guestId)
                    .executeUpdate();
            entityManager.createNativeQuery("""
                    INSERT INTO guest_transfer_codes(id,user_id,code_hash,created_at,expires_at)
                    VALUES (:id,:guestId,:codeHash,:now,:expiresAt)
                    """)
                    .setParameter("id", UUID.randomUUID())
                    .setParameter("guestId", guestId)
                    .setParameter("codeHash", codeHash)
                    .setParameter("now", now.atOffset(ZoneOffset.UTC))
                    .setParameter("expiresAt", expiresAt.atOffset(ZoneOffset.UTC))
                    .executeUpdate();
            return true;
        }));
    }

    /**
     * {@code FOR UPDATE} 로 잡는다 — 같은 코드를 든 두 요청 가운데 뒤의 것은 앞의 것이 끝날 때까지
     * 기다렸다가 "이미 쓴 코드"를 본다. 살아 있는 것이 둘이면(발급이 막지만) 어느 게스트인지 알 수 없어
     * 없는 코드로 다룬다.
     */
    @Override
    public LiveCode lockLive(String codeHash, Instant now) {
        List<Tuple> rows = list(entityManager.createNativeQuery("""
                SELECT id,user_id
                FROM guest_transfer_codes
                WHERE code_hash=:codeHash
                  AND used_at IS NULL
                  AND expires_at>:now
                FOR UPDATE
                """, Tuple.class)
                .setParameter("codeHash", codeHash)
                .setParameter("now", now.atOffset(ZoneOffset.UTC)));
        if (rows.size() != 1) {
            return null;
        }
        return new LiveCode(rows.getFirst().get("id", UUID.class), rows.getFirst().get("user_id", UUID.class));
    }

    @Override
    public void markUsed(UUID codeId, Instant now) {
        entityManager.createNativeQuery("""
                UPDATE guest_transfer_codes
                SET used_at=:now
                WHERE id=:codeId
                """)
                .setParameter("now", now.atOffset(ZoneOffset.UTC))
                .setParameter("codeId", codeId)
                .executeUpdate();
    }

    @Override
    public <T> T inTransaction(Supplier<T> work) {
        return transaction.execute(status -> work.get());
    }
}
