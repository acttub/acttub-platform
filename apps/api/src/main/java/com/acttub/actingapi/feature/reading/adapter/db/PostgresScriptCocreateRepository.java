package com.acttub.actingapi.feature.reading.adapter.db;

import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.reading.app.ScriptCocreateRepository;
import com.acttub.actingapi.platform.persistence.NativeTuples;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Tuple;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 찍을 대사 같이 만들기의 Postgres 구현 — {@code script_cocreations} (V55). native SQL 만 쓴다(Schema Entity 없음).
 *
 * <p>사람({@code users})에 ON DELETE CASCADE, 확정한 대본({@code scripts})에 ON DELETE SET NULL 로 매달린다. 겹친 생성은
 * (사람, 요청 id) 유일 제약이, 겹친 수정은 조건부 UPDATE 한 문장이 가른다.
 */
@Repository
class PostgresScriptCocreateRepository implements ScriptCocreateRepository {

    private static final String SELECT = """
            SELECT id,request_id,conditions,versions,current_version,revisions_used,model,busy_since,script_id,created_at
            FROM script_cocreations
            """;

    private final EntityManager entityManager;
    private final TransactionTemplate transaction;

    PostgresScriptCocreateRepository(EntityManager entityManager, PlatformTransactionManager transactionManager) {
        this.entityManager = entityManager;
        this.transaction = new TransactionTemplate(transactionManager);
    }

    @Override
    public Row find(UUID userId, UUID id) {
        return first(NativeTuples.list(entityManager.createNativeQuery(SELECT + " WHERE id=:id AND user_id=:userId", Tuple.class)
                .setParameter("id", id)
                .setParameter("userId", userId)));
    }

    @Override
    public <T> T withSaveLock(UUID userId, UUID id, java.util.function.Function<Row, T> save) {
        return transaction.execute(tx -> {
            // ScriptRepository/탈퇴와 같은 순서: 사용자 → 생성 행. create와 link도 이 트랜잭션에 참여한다.
            entityManager.createNativeQuery("SELECT id FROM users WHERE id=:userId FOR UPDATE")
                    .setParameter("userId", userId).getResultList();
            Row row = first(NativeTuples.list(entityManager.createNativeQuery(
                    SELECT + " WHERE id=:id AND user_id=:userId FOR UPDATE", Tuple.class)
                    .setParameter("id", id).setParameter("userId", userId)));
            return save.apply(row);
        });
    }

    @Override
    public Row findByRequest(UUID userId, UUID requestId) {
        return first(NativeTuples.list(entityManager.createNativeQuery(
                SELECT + " WHERE user_id=:userId AND request_id=:requestId", Tuple.class)
                .setParameter("requestId", requestId)
                .setParameter("userId", userId)));
    }

    @Override
    public boolean insertPending(UUID id, UUID userId, UUID requestId, Instant now) {
        return update("""
                INSERT INTO script_cocreations(id,user_id,request_id,created_at,updated_at)
                VALUES (:id,:userId,:requestId,:now,:now)
                ON CONFLICT (user_id,request_id) DO NOTHING
                """, q -> q.setParameter("id", id).setParameter("userId", userId).setParameter("requestId", requestId)
                .setParameter("now", at(now))) == 1;
    }

    @Override
    public void deletePending(UUID id) {
        update("DELETE FROM script_cocreations WHERE id=:id AND versions IS NULL", q -> q.setParameter("id", id));
    }

    @Override
    public void complete(UUID id, String conditions, String versions, String model, Instant now) {
        update("""
                UPDATE script_cocreations
                SET conditions=:conditions,versions=:versions,current_version=1,model=:model,updated_at=:now
                WHERE id=:id
                """, q -> q.setParameter("id", id).setParameter("conditions", conditions).setParameter("versions", versions)
                .setParameter("model", model).setParameter("now", at(now)));
    }

    @Override
    public int countSince(UUID userId, Instant since) {
        Number count = (Number) entityManager.createNativeQuery(
                "SELECT count(*) FROM script_cocreations WHERE user_id=:userId AND created_at>=:since")
                .setParameter("userId", userId)
                .setParameter("since", at(since))
                .getSingleResult();
        return count.intValue();
    }

    @Override
    public List<String> recentConditions(UUID userId, int limit) {
        return NativeTuples.list(entityManager.createNativeQuery("""
                SELECT conditions FROM script_cocreations
                WHERE user_id=:userId AND conditions IS NOT NULL
                ORDER BY created_at DESC
                LIMIT :limit
                """, Tuple.class)
                .setParameter("userId", userId)
                .setParameter("limit", limit))
                .stream()
                .map(row -> row.get("conditions", String.class))
                .toList();
    }

    @Override
    public boolean claim(UUID userId, UUID id, int version, int revisionLimit, Instant now, Instant staleBefore) {
        return update("""
                UPDATE script_cocreations
                SET busy_since=:now,updated_at=:now
                WHERE id=:id AND user_id=:userId AND versions IS NOT NULL AND current_version=:version
                  AND script_id IS NULL AND revisions_used<:revisionLimit
                  AND (busy_since IS NULL OR busy_since<:staleBefore)
                """, q -> q.setParameter("id", id).setParameter("userId", userId).setParameter("version", version)
                .setParameter("revisionLimit", revisionLimit).setParameter("now", at(now))
                .setParameter("staleBefore", at(staleBefore))) == 1;
    }

    @Override
    public void release(UUID id) {
        update("UPDATE script_cocreations SET busy_since=NULL WHERE id=:id", q -> q.setParameter("id", id));
    }

    @Override
    public void appendVersion(UUID id, String versions, int currentVersion, Instant now) {
        int changed = update("""
                UPDATE script_cocreations
                SET versions=:versions,current_version=:currentVersion,revisions_used=revisions_used+1,busy_since=NULL,
                    updated_at=:now
                WHERE id=:id AND script_id IS NULL AND busy_since IS NOT NULL
                """, q -> q.setParameter("id", id).setParameter("versions", versions)
                .setParameter("currentVersion", currentVersion).setParameter("now", at(now)));
        if (changed != 1) {
            throw new com.acttub.actingapi.platform.web.ApiException(409, "sample_script_version_conflict");
        }
    }

    @Override
    public boolean restore(UUID userId, UUID id, int version, Instant now) {
        return update("""
                UPDATE script_cocreations
                SET current_version=:version,updated_at=:now
                WHERE id=:id AND user_id=:userId AND versions IS NOT NULL AND script_id IS NULL AND busy_since IS NULL
                """, q -> q.setParameter("id", id).setParameter("userId", userId).setParameter("version", version)
                .setParameter("now", at(now))) == 1;
    }

    @Override
    public void linkScript(UUID userId, UUID id, UUID scriptId, Instant now) {
        update("""
                UPDATE script_cocreations SET script_id=:scriptId,updated_at=:now
                WHERE id=:id AND user_id=:userId
                """, q -> q.setParameter("id", id).setParameter("userId", userId).setParameter("scriptId", scriptId)
                .setParameter("now", at(now)));
    }

    private int update(String sql, java.util.function.UnaryOperator<jakarta.persistence.Query> bind) {
        Integer changed = transaction.execute(tx -> bind.apply(entityManager.createNativeQuery(sql)).executeUpdate());
        return changed == null ? 0 : changed;
    }

    private static OffsetDateTime at(Instant instant) {
        return instant.atOffset(ZoneOffset.UTC);
    }

    private static Row first(List<Tuple> rows) {
        if (rows.isEmpty()) {
            return null;
        }
        Tuple row = rows.getFirst();
        return new Row(
                row.get("id", UUID.class),
                row.get("request_id", UUID.class),
                row.get("conditions", String.class),
                row.get("versions", String.class),
                row.get("current_version", Integer.class),
                row.get("revisions_used", Integer.class),
                row.get("model", String.class),
                row.get("busy_since", Instant.class),
                row.get("script_id", UUID.class),
                row.get("created_at", Instant.class));
    }
}
