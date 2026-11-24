package com.acttub.actingapi.feature.portfolio.adapter.db;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import com.acttub.actingapi.feature.portfolio.schema.PortfolioPhotoEntity;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;

interface PortfolioPhotoJpaRepository extends JpaRepository<PortfolioPhotoEntity, UUID> {

    List<PortfolioPhotoEntity> findByUserIdAndUploadedAtIsNotNullOrderBySortOrderAscUploadedAtAscIdAsc(UUID userId);

    List<PortfolioPhotoEntity> findByUserIdAndUploadedAtIsNotNull(UUID userId);

    Optional<PortfolioPhotoEntity> findByIdAndUserId(UUID id, UUID userId);

    long countByUserId(UUID userId);

    /** 시한이 지난 올리기. 잡은 행을 그대로 지워 읽은 키와 지운 행이 같게 한다(RETURNING 대신). */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    List<PortfolioPhotoEntity> findByUserIdAndUploadedAtIsNullAndExpiresAtLessThanEqual(UUID userId, Instant now);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT photo FROM PortfolioPhotoEntity photo WHERE photo.id = :id AND photo.userId = :userId")
    Optional<PortfolioPhotoEntity> lockOwned(UUID id, UUID userId);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            UPDATE PortfolioPhotoEntity photo
            SET photo.uploadedAt = :now,
                photo.sortOrder = (SELECT COALESCE(MAX(other.sortOrder), -1) + 1
                                   FROM PortfolioPhotoEntity other
                                   WHERE other.userId = :userId AND other.uploadedAt IS NOT NULL)
            WHERE photo.id = :id AND photo.userId = :userId AND photo.uploadedAt IS NULL
            """)
    int complete(UUID id, UUID userId, Instant now);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("UPDATE PortfolioPhotoEntity photo SET photo.sortOrder = :sortOrder WHERE photo.id = :id AND photo.userId = :userId")
    int moveTo(UUID id, UUID userId, int sortOrder);
}
