package com.acttub.actingapi.feature.reading.adapter.db;

import static com.acttub.actingapi.platform.persistence.NativeTuples.list;

import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import com.acttub.actingapi.feature.reading.app.ScriptFileCleanup;
import com.acttub.actingapi.feature.reading.app.ScriptUploadRepository;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Tuple;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 대본 원본 파일 장부의 Postgres 구현 (V34 {@code script_uploads}, V39 {@code failure}·{@code kept_until}). 대본에 연결하는 쪽은
 * 나누기 저장소({@code PostgresScriptImportRepository#linkUpload})이고, 지우는 쪽은 대본 삭제·탈퇴·이 클래스의 미연결 정리다.
 *
 * <p>실패 남기기와 미연결 정리는 한 문장 안에서 동의(consent 의 표)와 진행 중인 나누기 작업(`ai_jobs`)을 함께 읽어 native SQL 로
 * 둔다(apps/api/CONTRACT.md §5-9).
 */
@Repository
class PostgresScriptUploadRepository implements ScriptUploadRepository {
    private final EntityManager em;
    private final ScriptUploadJpaRepository rows;
    private final TransactionTemplate transaction;
    private final ScriptFileCleanup cleanup;

    PostgresScriptUploadRepository(EntityManager em, ScriptUploadJpaRepository rows, PlatformTransactionManager manager,
            ScriptFileCleanup cleanup) {
        this.em = em;
        this.rows = rows;
        this.transaction = new TransactionTemplate(manager);
        this.cleanup = cleanup;
    }

    @Override
    public void reserve(UUID userId, UUID uploadId, String objectKey, String fileName, long byteSize, Instant expiresAt, Instant now) {
        transaction.executeWithoutResult(status -> rows.insert(uploadId, userId, objectKey, fileName, byteSize, expiresAt, now));
    }

    @Override
    public Upload find(UUID userId, UUID uploadId) {
        return rows.find(uploadId, userId)
                .map(row -> new Upload(row.getId(), row.getObjectKey(), row.getByteSize(), row.getRawText(),
                        row.getScriptId() != null, row.getLinkedRequestId()))
                .orElse(null);
    }

    @Override
    public void saveText(UUID uploadId, String rawText, Instant now) {
        transaction.executeWithoutResult(status -> rows.saveText(uploadId, rawText, now));
    }

    @Override
    public void recordFailure(UUID uploadId, String failure, Instant keptUntil, Instant now) {
        transaction.executeWithoutResult(status -> em.createNativeQuery("""
                UPDATE script_uploads u
                SET failure=:failure,
                    kept_until=CASE WHEN %s='granted' THEN CAST(:keptUntil AS timestamptz) END,
                    updated_at=:now
                WHERE u.id=:id AND u.script_id IS NULL
                """.formatted(PostgresScriptImportRepository.splitDecision("u.user_id")))
                .setParameter("failure", failure).setParameter("keptUntil", keptUntil.atOffset(ZoneOffset.UTC))
                .setParameter("now", now.atOffset(ZoneOffset.UTC)).setParameter("id", uploadId).executeUpdate());
    }

    @Override
    public List<UUID> sweepUnlinked(Instant before, Instant now) {
        return transaction.execute(status -> {
            var removed = list(em.createNativeQuery("""
                    WITH stale AS (
                        SELECT u.id FROM script_uploads u
                        WHERE u.script_id IS NULL
                          AND ((u.kept_until IS NULL AND u.created_at<:before)
                               OR u.kept_until<:now
                               OR (u.kept_until IS NOT NULL AND %s IS DISTINCT FROM 'granted'))
                          AND NOT EXISTS (SELECT 1 FROM script_imports i JOIN ai_jobs j ON j.id=i.job_id
                                          WHERE i.upload_id=u.id AND j.status IN ('pending','running'))
                        ORDER BY u.created_at
                        LIMIT 500
                        FOR UPDATE OF u SKIP LOCKED
                    ), removed AS (
                        DELETE FROM script_uploads u USING stale WHERE u.id=stale.id
                        RETURNING u.user_id,u.object_key,u.expires_at
                    )
                    SELECT user_id,object_key,expires_at FROM removed
                    """.formatted(PostgresScriptImportRepository.latestSplitDecision("u.user_id")), Tuple.class)
                    .setParameter("before", before.atOffset(ZoneOffset.UTC)).setParameter("now", now.atOffset(ZoneOffset.UTC)));
            Map<UUID, List<Tuple>> byUser = new LinkedHashMap<>();
            for (Tuple row : removed) {
                byUser.computeIfAbsent(row.get("user_id", UUID.class), user -> new ArrayList<>()).add(row);
            }
            List<UUID> scheduled = new ArrayList<>();
            byUser.forEach((userId, rows) -> scheduled.add(cleanup.schedule(userId,
                    rows.stream().map(row -> row.get("object_key", String.class)).toList(), now,
                    rows.stream().map(row -> row.get("expires_at", Instant.class)).max(Instant::compareTo).orElseThrow())));
            return scheduled;
        });
    }
}
