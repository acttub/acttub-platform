package com.acttub.actingapi.feature.community.adapter.db;

import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;

import com.acttub.actingapi.feature.auth.app.AccountRowLock;
import com.acttub.actingapi.feature.community.app.CommunityImageCleanup;
import com.acttub.actingapi.feature.community.app.CommunityImageRepository;
import com.acttub.actingapi.feature.community.schema.CommunityPostImageEntity;
import jakarta.persistence.EntityManager;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 게시판 사진의 올리기 장부를 다룬다. 글에 붙이고 떼는 일은 {@link PostgresCommunityRepository} 가 글 쓰기와 같은
 * 트랜잭션에서 한다. 올린 사람의 {@code users} 행 잠금만 native SQL 이다 — 그 표의 주인은 auth 이고 잠금을 내주는 Port 가
 * 없다(apps/api/CONTRACT.md §5-9, {@code native-sql-files.txt} 의 남김 줄).
 */
@Repository
class PostgresCommunityImageRepository implements CommunityImageRepository {
    private final CommunityPostImageJpaRepository images;
    private final EntityManager entityManager;
    private final TransactionTemplate transaction;
    private final CommunityImageCleanup cleanup;

    private final AccountRowLock accountRows;

    PostgresCommunityImageRepository(
            CommunityPostImageJpaRepository images,
            EntityManager entityManager,
            PlatformTransactionManager transactionManager,
            CommunityImageCleanup cleanup,
            AccountRowLock accountRows) {
        this.accountRows = accountRows;
        this.images = images;
        this.entityManager = entityManager;
        this.transaction = new TransactionTemplate(transactionManager);
        this.cleanup = cleanup;
    }

    /** 사람 행을 잡고 센다 — 같은 사람의 동시 올리기 둘이 서로를 못 보고 한도를 넘지 않게. */
    @Override
    public boolean begin(PendingImage image, int pendingLimit, Instant now) {
        return Boolean.TRUE.equals(transaction.execute(status -> {
            accountRows.lockRow(image.uploaderId());
            if (images.countUnattached(image.uploaderId()) >= pendingLimit) {
                return false;
            }
            images.save(new CommunityPostImageEntity(image.id(), image.uploaderId(), image.objectKey(), image.mimeType(),
                    image.sizeBytes(), now, image.expiresAt()));
            return true;
        }));
    }

    @Override
    public PendingImage find(UUID uploaderId, UUID imageId) {
        return images.findOwned(imageId, uploaderId)
                .map(row -> new PendingImage(row.getId(), row.getUploaderId(), row.getPostId(), row.getObjectKey(),
                        row.getMimeType(), row.getSizeBytes(), row.getExpiresAt(), row.getUploadedAt() != null))
                .orElse(null);
    }

    @Override
    public void markUploaded(UUID imageId, Instant now) {
        transaction.executeWithoutResult(status -> images.markUploaded(imageId, now));
    }

    /**
     * 붙지 않은 오래된 행을 지우고 올린 사람별로 객체 삭제를 장부에 올린다. 올리기 주소가 아직 살아 있으면 그 시한 뒤에
     * 지운다(먼저 지우면 그 뒤에 올라온 객체가 장부 밖에 남는다). 글 쓰기가 같은 행을 잠그고 붙였으면 그 행은
     * {@code post_id IS NULL} 에 걸리지 않아 남는다.
     *
     * <p>지울 행을 잠가 읽고 그 id 로 지운다. 읽은 뒤에 조건에 들게 된 행은 이번에 지우지 않고 다음 차례에 남는다.
     */
    @Override
    public List<UUID> sweepUnattached(Instant before, Instant now) {
        return Objects.requireNonNull(transaction.execute(status -> {
            List<CommunityPostImageEntity> removed = images.lockUnattachedBefore(before);
            if (removed.isEmpty()) {
                return List.of();
            }
            images.deleteByIds(removed.stream().map(CommunityPostImageEntity::getId).toList());
            Map<UUID, List<CommunityPostImageEntity>> byUploader = new LinkedHashMap<>();
            removed.forEach(row -> byUploader.computeIfAbsent(row.getUploaderId(), key -> new ArrayList<>()).add(row));
            List<UUID> operations = new ArrayList<>();
            byUploader.forEach((uploader, rows) -> {
                Instant notBefore = rows.stream().map(CommunityPostImageEntity::getExpiresAt)
                        .max(Instant::compareTo).filter(now::isBefore).orElse(now);
                operations.add(cleanup.schedule(
                        uploader, rows.stream().map(CommunityPostImageEntity::getObjectKey).toList(), now, notBefore));
            });
            return operations;
        }));
    }
}
