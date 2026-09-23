package com.acttub.actingapi.feature.reading.adapter.db;

import java.time.Instant;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

import com.acttub.actingapi.feature.reading.app.MemorizationRepository;
import com.acttub.actingapi.platform.persistence.NativeTuples;
import com.acttub.actingapi.platform.schema.MemorizationStatus;
import com.acttub.actingapi.platform.schema.ScriptLineKind;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Tuple;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 암기 표시는 <b>(user_id, line_id) 유일</b>이라 {@code ON CONFLICT DO UPDATE} 한 문장으로 두거나 바꾼다 — 조회 후 쓰기는
 * 두 기기의 상반된 갱신에서 승자 판정을 깨뜨린다(apps/api/CONTRACT.md §5-2). 같은 상태면 {@code updated_at} 을 그대로 둔다.
 *
 * <p>갱신은 그 줄의 <b>대본 행을 {@code FOR UPDATE} 로 잡고</b> 주인이 맞는지 본다. 이관은 대본 행을 고친 뒤 암기 표시를
 * 옮기므로, 잠금을 기다린 뒤 다시 본 대본이 남의 것이면 404 이고 옛 계정에 아무것도 남지 않는다.
 */
@Repository
class PostgresMemorizationRepository implements MemorizationRepository {
    private final EntityManager entityManager;
    private final TransactionTemplate transaction;

    PostgresMemorizationRepository(EntityManager entityManager, PlatformTransactionManager transactionManager) {
        this.entityManager = entityManager;
        this.transaction = new TransactionTemplate(transactionManager);
    }

    @Override
    public Change set(UUID userId, UUID lineId, String status, Instant now) {
        // timestamptz 는 마이크로초까지만 남으므로 같은 정밀도로 적고 비교한다.
        Instant stamp = now.truncatedTo(ChronoUnit.MICROS);
        return transaction.execute(tx -> {
            List<Tuple> lines = NativeTuples.list(entityManager.createNativeQuery("""
                    SELECT l.kind
                    FROM script_lines l
                    JOIN scripts s ON s.id=l.script_id
                    WHERE l.id=:lineId
                      AND s.user_id=:userId
                    FOR UPDATE OF s
                    """, Tuple.class)
                    .setParameter("lineId", lineId)
                    .setParameter("userId", userId));
            if (lines.isEmpty()) {
                return null;
            }
            if (!ScriptLineKind.DIALOGUE.dbValue().equals(lines.getFirst().get("kind", String.class))) {
                return new Change(Outcome.INVALID_LINE, null);
            }
            Tuple row = NativeTuples.list(entityManager.createNativeQuery("""
                    WITH changed AS (
                        INSERT INTO line_memorization(id,user_id,line_id,status,created_at,updated_at)
                        VALUES (:id,:userId,:lineId,:status,:now,:now)
                        ON CONFLICT (user_id,line_id) DO UPDATE
                        SET status=EXCLUDED.status,
                            updated_at=CASE WHEN line_memorization.status=EXCLUDED.status
                                            THEN line_memorization.updated_at ELSE EXCLUDED.updated_at END
                        RETURNING line_id,status,updated_at
                    )
                    SELECT line_id,status,updated_at FROM changed
                    """, Tuple.class)
                    .setParameter("id", UUID.randomUUID())
                    .setParameter("userId", userId)
                    .setParameter("lineId", lineId)
                    .setParameter("status", MemorizationStatus.valueOf(status.toUpperCase(Locale.ROOT)).dbValue())
                    .setParameter("now", stamp.atOffset(ZoneOffset.UTC))).getFirst();
            MemorizationView view = view(row);
            return new Change(view.updatedAt().equals(stamp) ? Outcome.SAVED : Outcome.UNCHANGED, view);
        });
    }

    @Override
    public List<MemorizationView> list(UUID userId, UUID scriptId) {
        boolean owned = !NativeTuples.list(entityManager.createNativeQuery(
                "SELECT id FROM scripts WHERE id=:scriptId AND user_id=:userId", Tuple.class)
                .setParameter("scriptId", scriptId)
                .setParameter("userId", userId)).isEmpty();
        if (!owned) {
            return null;
        }
        return NativeTuples.list(entityManager.createNativeQuery("""
                SELECT m.line_id,m.status,m.updated_at
                FROM line_memorization m
                JOIN script_lines l ON l.id=m.line_id
                WHERE l.script_id=:scriptId
                  AND m.user_id=:userId
                ORDER BY l.ordinal
                """, Tuple.class)
                .setParameter("scriptId", scriptId)
                .setParameter("userId", userId)).stream()
                .map(PostgresMemorizationRepository::view)
                .toList();
    }

    private static MemorizationView view(Tuple row) {
        return new MemorizationView(
                row.get("line_id", UUID.class),
                MemorizationStatus.valueOf(row.get("status", String.class).toUpperCase(Locale.ROOT)).dbValue(),
                row.get("updated_at", Instant.class));
    }
}
