package com.acttub.actingapi.feature.reading.adapter.db;

import static com.acttub.actingapi.platform.persistence.NativeTuples.list;

import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import com.acttub.actingapi.feature.reading.app.ReadingRecordingCleanup;
import com.acttub.actingapi.feature.reading.app.ScriptUploadRepository;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Tuple;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 대본 원본 파일 장부의 Postgres 구현 (V34 {@code script_uploads}). 대본에 연결하는 쪽은 나누기 저장소
 * ({@code PostgresScriptImportRepository#linkUpload})이고, 지우는 쪽은 대본 삭제·탈퇴·이 클래스의 미연결 정리다.
 */
@Repository
class PostgresScriptUploadRepository implements ScriptUploadRepository {
    private final EntityManager em;
    private final TransactionTemplate transaction;
    private final ReadingRecordingCleanup cleanup;

    PostgresScriptUploadRepository(EntityManager em, PlatformTransactionManager manager, ReadingRecordingCleanup cleanup) {
        this.em = em;
        this.transaction = new TransactionTemplate(manager);
        this.cleanup = cleanup;
    }

    @Override
    public void reserve(UUID userId, UUID uploadId, String objectKey, long byteSize, Instant expiresAt, Instant now) {
        transaction.executeWithoutResult(status -> em.createNativeQuery("""
                INSERT INTO script_uploads(id,user_id,object_key,byte_size,expires_at,created_at,updated_at)
                VALUES (:id,:userId,:objectKey,:byteSize,:expiresAt,:now,:now)
                """).setParameter("id", uploadId).setParameter("userId", userId).setParameter("objectKey", objectKey)
                .setParameter("byteSize", byteSize).setParameter("expiresAt", expiresAt.atOffset(ZoneOffset.UTC))
                .setParameter("now", now.atOffset(ZoneOffset.UTC)).executeUpdate());
    }

    @Override
    public Upload find(UUID userId, UUID uploadId) {
        var rows = list(em.createNativeQuery(
                "SELECT id,object_key,byte_size,raw_text FROM script_uploads WHERE id=:id AND user_id=:userId", Tuple.class)
                .setParameter("id", uploadId).setParameter("userId", userId));
        if (rows.isEmpty()) return null;
        Tuple row = rows.getFirst();
        return new Upload(row.get("id", UUID.class), row.get("object_key", String.class),
                ((Number) row.get("byte_size")).longValue(), row.get("raw_text", String.class));
    }

    @Override
    public void saveText(UUID uploadId, String rawText, Instant now) {
        transaction.executeWithoutResult(status -> em.createNativeQuery("""
                UPDATE script_uploads SET raw_text=:rawText,updated_at=:now WHERE id=:id
                """).setParameter("rawText", rawText).setParameter("now", now.atOffset(ZoneOffset.UTC))
                .setParameter("id", uploadId).executeUpdate());
    }

    @Override
    public List<UUID> sweepUnlinked(Instant before, Instant now) {
        return transaction.execute(status -> {
            var removed = list(em.createNativeQuery("""
                    WITH stale AS (
                        SELECT u.id FROM script_uploads u
                        WHERE u.script_id IS NULL AND u.created_at<:before
                          AND NOT EXISTS (SELECT 1 FROM script_imports i JOIN ai_jobs j ON j.id=i.job_id
                                          WHERE i.upload_id=u.id AND j.status IN ('pending','running'))
                        ORDER BY u.created_at
                        LIMIT 500
                        FOR UPDATE OF u SKIP LOCKED
                    ), removed AS (
                        DELETE FROM script_uploads u USING stale WHERE u.id=stale.id
                        RETURNING u.user_id,u.object_key
                    )
                    SELECT user_id,object_key FROM removed
                    """, Tuple.class).setParameter("before", before.atOffset(ZoneOffset.UTC)));
            Map<UUID, List<String>> keys = new LinkedHashMap<>();
            for (Tuple row : removed) {
                keys.computeIfAbsent(row.get("user_id", UUID.class), user -> new ArrayList<>())
                        .add(row.get("object_key", String.class));
            }
            List<UUID> scheduled = new ArrayList<>();
            keys.forEach((userId, objectKeys) -> scheduled.add(cleanup.schedule(userId, objectKeys, now)));
            return scheduled;
        });
    }
}
