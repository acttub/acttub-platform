package com.acttub.actingapi.feature.community.adapter.db;

import static com.acttub.actingapi.platform.persistence.NativeTuples.list;

import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;

import com.acttub.actingapi.feature.community.app.CommunityImageCleanup;
import com.acttub.actingapi.feature.community.app.CommunityImageRepository;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Tuple;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 게시판 사진의 올리기 장부를 native SQL 로 다룬다. 글에 붙이고 떼는 일은 {@link PostgresCommunityRepository} 가
 * 글 쓰기와 같은 트랜잭션에서 한다.
 */
@Repository
class PostgresCommunityImageRepository implements CommunityImageRepository {
    private final EntityManager entityManager;
    private final TransactionTemplate transaction;
    private final CommunityImageCleanup cleanup;

    PostgresCommunityImageRepository(
            EntityManager entityManager, PlatformTransactionManager transactionManager, CommunityImageCleanup cleanup) {
        this.entityManager = entityManager;
        this.transaction = new TransactionTemplate(transactionManager);
        this.cleanup = cleanup;
    }

    /** 사람 행을 잡고 센다 — 같은 사람의 동시 올리기 둘이 서로를 못 보고 한도를 넘지 않게. */
    @Override
    public boolean begin(PendingImage image, int pendingLimit, Instant now) {
        return Boolean.TRUE.equals(transaction.execute(status -> {
            list(entityManager.createNativeQuery("SELECT id AS id FROM users WHERE id = :userId FOR UPDATE", Tuple.class)
                    .setParameter("userId", image.uploaderId()));
            Number pending = (Number) entityManager.createNativeQuery("""
                    SELECT count(*) FROM community_post_images WHERE uploader_id = :userId AND post_id IS NULL
                    """)
                    .setParameter("userId", image.uploaderId())
                    .getSingleResult();
            if (pending.intValue() >= pendingLimit) {
                return false;
            }
            entityManager.createNativeQuery("""
                    INSERT INTO community_post_images
                        (id, uploader_id, object_key, mime_type, size_bytes, created_at, expires_at)
                    VALUES (:id, :userId, :objectKey, :mimeType, :sizeBytes, :now, :expiresAt)
                    """)
                    .setParameter("id", image.id())
                    .setParameter("userId", image.uploaderId())
                    .setParameter("objectKey", image.objectKey())
                    .setParameter("mimeType", image.mimeType())
                    .setParameter("sizeBytes", image.sizeBytes())
                    .setParameter("now", now.atOffset(ZoneOffset.UTC))
                    .setParameter("expiresAt", image.expiresAt().atOffset(ZoneOffset.UTC))
                    .executeUpdate();
            return true;
        }));
    }

    @Override
    public PendingImage find(UUID uploaderId, UUID imageId) {
        List<Tuple> rows = list(entityManager.createNativeQuery("""
                SELECT id AS id, uploader_id AS uploader_id, post_id AS post_id, object_key AS object_key,
                       mime_type AS mime_type, size_bytes AS size_bytes, expires_at AS expires_at,
                       uploaded_at IS NOT NULL AS uploaded
                FROM community_post_images
                WHERE id = :id AND uploader_id = :userId
                """, Tuple.class)
                .setParameter("id", imageId)
                .setParameter("userId", uploaderId));
        if (rows.isEmpty()) {
            return null;
        }
        Tuple row = rows.getFirst();
        return new PendingImage(
                row.get("id", UUID.class),
                row.get("uploader_id", UUID.class),
                row.get("post_id", UUID.class),
                row.get("object_key", String.class),
                row.get("mime_type", String.class),
                ((Number) row.get("size_bytes")).longValue(),
                row.get("expires_at", Instant.class),
                row.get("uploaded", Boolean.class));
    }

    @Override
    public void markUploaded(UUID imageId, Instant now) {
        transaction.executeWithoutResult(status -> entityManager.createNativeQuery("""
                UPDATE community_post_images SET uploaded_at = :now WHERE id = :id AND uploaded_at IS NULL
                """)
                .setParameter("id", imageId)
                .setParameter("now", now.atOffset(ZoneOffset.UTC))
                .executeUpdate());
    }

    /**
     * 붙지 않은 오래된 행을 지우고 올린 사람별로 객체 삭제를 장부에 올린다. 올리기 주소가 아직 살아 있으면 그 시한 뒤에
     * 지운다(먼저 지우면 그 뒤에 올라온 객체가 장부 밖에 남는다). 글 쓰기가 같은 행을 잠그고 붙였으면 그 행은
     * {@code post_id IS NULL} 에 걸리지 않아 남는다.
     */
    @Override
    public List<UUID> sweepUnattached(Instant before, Instant now) {
        return Objects.requireNonNull(transaction.execute(status -> {
            List<Tuple> removed = list(entityManager.createNativeQuery("""
                    WITH removed AS (
                        DELETE FROM community_post_images
                        WHERE post_id IS NULL AND created_at < :before
                        RETURNING uploader_id, object_key, expires_at
                    )
                    SELECT uploader_id AS uploader_id, object_key AS object_key, expires_at AS expires_at FROM removed
                    """, Tuple.class)
                    .setParameter("before", before.atOffset(ZoneOffset.UTC)));
            Map<UUID, List<Tuple>> byUploader = new LinkedHashMap<>();
            removed.forEach(row -> byUploader.computeIfAbsent(row.get("uploader_id", UUID.class), key -> new ArrayList<>())
                    .add(row));
            List<UUID> operations = new ArrayList<>();
            byUploader.forEach((uploader, rows) -> {
                Instant notBefore = rows.stream().map(row -> row.get("expires_at", Instant.class))
                        .max(Instant::compareTo).filter(now::isBefore).orElse(now);
                operations.add(cleanup.schedule(
                        uploader, rows.stream().map(row -> row.get("object_key", String.class)).toList(), now, notBefore));
            });
            return operations;
        }));
    }
}
