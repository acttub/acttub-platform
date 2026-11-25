package com.acttub.actingapi.feature.reading.adapter.db;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

import com.acttub.actingapi.feature.reading.app.MemorizationRepository;
import com.acttub.actingapi.feature.reading.schema.LineMemorizationEntity;
import com.acttub.actingapi.platform.schema.MemorizationStatus;
import com.acttub.actingapi.platform.persistence.NativeTuples;
import com.acttub.actingapi.platform.schema.ScriptLineKind;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Tuple;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 암기 표시는 <b>(user_id, line_id) 유일</b>이라 {@code ON CONFLICT DO UPDATE} 한 문장으로 두거나 바꾼다 — 조회 후 쓰기는
 * 두 기기의 상반된 갱신에서 승자 판정을 깨뜨린다(apps/api/CONTRACT.md §5-2). 같은 상태면 {@code updated_at} 을 그대로 둔다.
 * 쓴 값은 같은 트랜잭션에서 다시 읽는다(§5-9).
 *
 * <p>갱신은 그 줄의 <b>대본 행을 {@code FOR UPDATE} 로 잡고</b> 주인이 맞는지 본다. 이관은 대본 행을 고친 뒤 암기 표시를
 * 옮기므로, 잠금을 기다린 뒤 다시 본 대본이 남의 것이면 404 이고 옛 계정에 아무것도 남지 않는다. 이 조회는 줄을 조인해
 * 종류를 읽으면서 대본 행만 잠근다({@code FOR UPDATE OF s}). HQL 은 select 절에 나온 표(줄)를 잠그므로 native SQL 로
 * 둔다(§5-9).
 */
@Repository
class PostgresMemorizationRepository implements MemorizationRepository {
    private final EntityManager entityManager;
    private final ScriptJpaRepository scripts;
    private final LineMemorizationJpaRepository memorization;
    private final TransactionTemplate transaction;

    PostgresMemorizationRepository(
            EntityManager entityManager,
            ScriptJpaRepository scripts,
            LineMemorizationJpaRepository memorization,
            PlatformTransactionManager transactionManager) {
        this.entityManager = entityManager;
        this.scripts = scripts;
        this.memorization = memorization;
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
            memorization.upsert(UUID.randomUUID(), userId, lineId,
                    MemorizationStatus.valueOf(status.toUpperCase(Locale.ROOT)), stamp);
            MemorizationView view = view(memorization.find(userId, lineId).orElseThrow());
            return new Change(view.updatedAt().equals(stamp) ? Outcome.SAVED : Outcome.UNCHANGED, view);
        });
    }

    @Override
    public List<MemorizationView> list(UUID userId, UUID scriptId) {
        if (scripts.owned(scriptId, userId).isEmpty()) {
            return null;
        }
        return memorization.ofScript(userId, scriptId).stream().map(PostgresMemorizationRepository::view).toList();
    }

    private static MemorizationView view(LineMemorizationEntity row) {
        return new MemorizationView(row.getLineId(), row.getStatus().dbValue(), row.getUpdatedAt());
    }
}
