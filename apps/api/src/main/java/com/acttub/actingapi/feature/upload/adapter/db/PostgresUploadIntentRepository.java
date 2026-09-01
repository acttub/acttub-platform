package com.acttub.actingapi.feature.upload.adapter.db;

import static com.acttub.actingapi.platform.schema.NativeTuples.list;

import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

import com.acttub.actingapi.feature.upload.app.UploadIntentRepository;
import com.acttub.actingapi.feature.upload.domain.UploadIntent;
import com.acttub.actingapi.feature.upload.schema.UploadIntentEntity;
import com.acttub.actingapi.platform.schema.UploadStatus;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Tuple;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

@Repository
class PostgresUploadIntentRepository implements UploadIntentRepository {
    private final UploadIntentJpaRepository uploads;
    private final EntityManager entityManager;
    private final TransactionTemplate transaction;

    PostgresUploadIntentRepository(
            UploadIntentJpaRepository uploads,
            EntityManager entityManager,
            PlatformTransactionManager transactionManager) {
        this.uploads = uploads;
        this.entityManager = entityManager;
        this.transaction = new TransactionTemplate(transactionManager);
    }

    @Override
    public UploadIntent create(
            UUID userId,
            String objectKey,
            String mimeType,
            long sizeBytes,
            Integer durationMs,
            Instant expiresAt) {
        UUID id = UUID.randomUUID();
        uploads.save(new UploadIntentEntity(
                id,
                userId,
                UploadStatus.PENDING,
                "s3",
                objectKey,
                mimeType,
                sizeBytes,
                durationMs,
                expiresAt));
        return find(userId, id);
    }

    @Override
    public UploadIntent find(UUID userId, UUID intentId) {
        return uploads.findByIdAndUserId(intentId, userId)
                .map(PostgresUploadIntentRepository::intent)
                .orElse(null);
    }

    @Override
    public UploadIntent finalizeIntent(
            UUID userId,
            UUID intentId,
            String etag,
            Instant now) {
        return transaction.execute(status -> {
            List<Tuple> rows = list(entityManager.createNativeQuery("""
                    WITH finalized AS (
                        UPDATE upload_intents
                        SET status='finalized',finalized_at=:now,etag=:etag
                        WHERE id=:intentId AND user_id=:userId
                          AND status='pending'
                          AND expires_at>:now
                        RETURNING id,user_id,status,storage_provider,object_key,mime_type,
                                  size_bytes,duration_ms,etag,created_at,expires_at,finalized_at
                    )
                    SELECT id,user_id,status,storage_provider,object_key,mime_type,
                           size_bytes,duration_ms,etag,created_at,expires_at,finalized_at
                    FROM finalized
                    """, Tuple.class)
                    .setParameter("now", now.atOffset(ZoneOffset.UTC))
                    .setParameter("etag", etag)
                    .setParameter("intentId", intentId)
                    .setParameter("userId", userId));
            return rows.isEmpty() ? null : intent(rows.getFirst());
        });
    }

    /**
     * 아는 어휘인지 확인하고 DB 값을 그대로 돌려준다.
     *
     * <p><b>Domain Model 이 문자열을 들되 느슨해지지는 않게 하는 자리다.</b> 열거형은
     * {@code jakarta.persistence} 를 끌고 있어 {@code domain} 으로 들일 수 없지만, 그렇다고
     * 어휘 밖 값을 통과시키면 재편이 실패 경로를 넓힌다 — 스키마를 먼저 넓히고 코드를 나중에
     * 좁히는 배포 순서에서 <b>DB 에 값이 먼저, 자바가 나중</b>은 실제로 일어난다. 종전처럼
     * 여기서 터지고 500 이 난다. ({@code practice} 가 검증 없이 문자열을 쓰는 것은 그쪽이
     * 재편 전부터 그랬기 때문이고, 이 넷은 열거형이었다.)
     */
    private static UploadIntent intent(UploadIntentEntity entity) {
        return new UploadIntent(
                entity.getId(),
                entity.getUserId(),
                entity.getStatus().dbValue(),
                entity.getStorageProvider(),
                entity.getObjectKey(),
                entity.getMimeType(),
                entity.getSizeBytes(),
                entity.getDurationMs(),
                entity.getEtag(),
                entity.getCreatedAt(),
                entity.getExpiresAt(),
                entity.getFinalizedAt());
    }

    private static UploadIntent intent(Tuple row) {
        Instant finalized = row.get("finalized_at", Instant.class);
        return new UploadIntent(
                row.get("id", UUID.class),
                row.get("user_id", UUID.class),
                status(row.get("status", String.class)),
                row.get("storage_provider", String.class),
                row.get("object_key", String.class),
                row.get("mime_type", String.class),
                row.get("size_bytes", Long.class),
                row.get("duration_ms", Integer.class),
                row.get("etag", String.class),
                row.get("created_at", Instant.class),
                row.get("expires_at", Instant.class),
                finalized);
    }

    private static String status(String raw) {
        return UploadStatus.valueOf(raw.toUpperCase(Locale.ROOT)).dbValue();
    }

}
