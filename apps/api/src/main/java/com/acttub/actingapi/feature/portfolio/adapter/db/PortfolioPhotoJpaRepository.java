package com.acttub.actingapi.feature.portfolio.adapter.db;

import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import com.acttub.actingapi.feature.portfolio.schema.PortfolioPhotoEntity;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;

/** {@code portfolio_photos} 를 읽고 쓰는 문장(apps/api/CONTRACT.md §5-9). */
interface PortfolioPhotoJpaRepository extends Repository<PortfolioPhotoEntity, UUID> {

    PortfolioPhotoEntity save(PortfolioPhotoEntity photo);

    @Query("""
            select p from PortfolioPhotoEntity p
            where p.userId = :userId and p.uploadedAt is not null
            order by p.sortOrder, p.uploadedAt, p.id
            """)
    List<PortfolioPhotoEntity> uploadedOf(UUID userId);

    Optional<PortfolioPhotoEntity> findByIdAndUserId(UUID id, UUID userId);

    long countByUserId(UUID userId);

    @Query("select p.id from PortfolioPhotoEntity p where p.userId = :userId and p.uploadedAt is not null")
    List<UUID> uploadedIdsOf(UUID userId);

    /** 시한이 지난 올리기를 잡는다. 지우기는 {@link #deleteRows} 로 이 행의 id 만 지운다. */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select p from PortfolioPhotoEntity p where p.userId = :userId and p.uploadedAt is null and p.expiresAt <= :now")
    List<PortfolioPhotoEntity> lockExpired(UUID userId, Instant now);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select p from PortfolioPhotoEntity p where p.id = :id and p.userId = :userId")
    Optional<PortfolioPhotoEntity> lockOwned(UUID id, UUID userId);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("delete from PortfolioPhotoEntity p where p.id in :ids")
    int deleteRows(Collection<UUID> ids);

    /** 올리기를 끝내고 올리기가 끝난 사진의 맨 끝 순서를 같은 문장에서 센다. 부르는 쪽이 포트폴리오 행을 잡고 있다. */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            update PortfolioPhotoEntity p
            set p.uploadedAt = :now,
                p.sortOrder = (select coalesce(max(other.sortOrder), -1) + 1
                               from PortfolioPhotoEntity other
                               where other.userId = :userId and other.uploadedAt is not null)
            where p.id = :id and p.userId = :userId and p.uploadedAt is null
            """)
    int complete(UUID id, UUID userId, Instant now);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("update PortfolioPhotoEntity p set p.sortOrder = :sortOrder where p.id = :id and p.userId = :userId")
    int moveTo(UUID id, UUID userId, int sortOrder);
}
