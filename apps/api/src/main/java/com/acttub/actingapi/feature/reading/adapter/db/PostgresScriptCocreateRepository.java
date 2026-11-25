package com.acttub.actingapi.feature.reading.adapter.db;

import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.function.Function;
import java.util.function.Supplier;

import com.acttub.actingapi.feature.reading.app.ScriptCocreateRepository;
import com.acttub.actingapi.feature.reading.schema.ScriptCocreationEntity;
import com.acttub.actingapi.platform.web.ApiException;
import jakarta.persistence.EntityManager;
import org.springframework.data.domain.Limit;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 찍을 대사 같이 만들기의 Postgres 구현 — {@code script_cocreations} (V56). 문장은 {@link ScriptCocreationJpaRepository} 에 있다.
 *
 * <p>사람({@code users})에 ON DELETE CASCADE, 확정한 대본({@code scripts})에 ON DELETE SET NULL 로 매달린다. 겹친 생성은
 * (사람, 요청 id) 유일 제약이, 겹친 수정은 조건부 UPDATE 한 문장이 가른다. {@code users} 는 auth 의 표라 그 잠금만 native SQL 로
 * 둔다(apps/api/CONTRACT.md §5-9).
 */
@Repository
class PostgresScriptCocreateRepository implements ScriptCocreateRepository {

    private final EntityManager entityManager;
    private final ScriptCocreationJpaRepository rows;
    private final TransactionTemplate transaction;

    PostgresScriptCocreateRepository(EntityManager entityManager, ScriptCocreationJpaRepository rows,
            PlatformTransactionManager transactionManager) {
        this.entityManager = entityManager;
        this.rows = rows;
        this.transaction = new TransactionTemplate(transactionManager);
    }

    @Override
    public Row find(UUID userId, UUID id) {
        return rows.find(id, userId).map(PostgresScriptCocreateRepository::row).orElse(null);
    }

    @Override
    public <T> T withSaveLock(UUID userId, UUID id, Function<Row, T> save) {
        return transaction.execute(tx -> {
            // ScriptRepository/탈퇴와 같은 순서: 사용자 → 생성 행. create와 link도 이 트랜잭션에 참여한다.
            entityManager.createNativeQuery("SELECT id FROM users WHERE id=:userId FOR UPDATE")
                    .setParameter("userId", userId).getResultList();
            return save.apply(rows.lock(id, userId).map(PostgresScriptCocreateRepository::row).orElse(null));
        });
    }

    @Override
    public Row findByRequest(UUID userId, UUID requestId) {
        return rows.findByRequest(userId, requestId).map(PostgresScriptCocreateRepository::row).orElse(null);
    }

    @Override
    public boolean insertPending(UUID id, UUID userId, UUID requestId, Instant now) {
        return update(() -> rows.insertPending(id, userId, requestId, now)) == 1;
    }

    @Override
    public void deletePending(UUID id) {
        update(() -> rows.deletePending(id));
    }

    @Override
    public void complete(UUID id, String conditions, String versions, String model, Instant now) {
        update(() -> rows.complete(id, conditions, versions, model, now));
    }

    @Override
    public int countSince(UUID userId, Instant since) {
        return (int) rows.countSince(userId, since);
    }

    @Override
    public List<String> recentConditions(UUID userId, int limit) {
        return rows.recentConditions(userId, Limit.of(limit));
    }

    @Override
    public boolean claim(UUID userId, UUID id, int version, int revisionLimit, Instant now, Instant staleBefore) {
        return update(() -> rows.claim(userId, id, version, revisionLimit, now, staleBefore)) == 1;
    }

    @Override
    public void release(UUID id) {
        update(() -> rows.release(id));
    }

    @Override
    public void appendVersion(UUID id, String versions, int currentVersion, Instant now) {
        if (update(() -> rows.appendVersion(id, versions, currentVersion, now)) != 1) {
            throw new ApiException(409, "sample_script_version_conflict");
        }
    }

    @Override
    public boolean restore(UUID userId, UUID id, int version, Instant now) {
        return update(() -> rows.restore(userId, id, version, now)) == 1;
    }

    @Override
    public void linkScript(UUID userId, UUID id, UUID scriptId, Instant now) {
        update(() -> rows.linkScript(userId, id, scriptId, now));
    }

    private int update(Supplier<Integer> statement) {
        Integer changed = transaction.execute(tx -> statement.get());
        return changed == null ? 0 : changed;
    }

    private static Row row(ScriptCocreationEntity entity) {
        return new Row(
                entity.getId(),
                entity.getRequestId(),
                entity.getConditions(),
                entity.getVersions(),
                entity.getCurrentVersion(),
                entity.getRevisionsUsed(),
                entity.getModel(),
                entity.getBusySince(),
                entity.getScriptId(),
                entity.getCreatedAt());
    }
}
