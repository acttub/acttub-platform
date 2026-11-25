package com.acttub.actingapi.feature.portfolio.adapter.db;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import com.acttub.actingapi.feature.portfolio.schema.PortfolioCreditEntity;
import com.acttub.actingapi.platform.schema.PortfolioCreditKind;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;

/** {@code portfolio_credits} 를 읽고 쓰는 문장(apps/api/CONTRACT.md §5-9). */
interface PortfolioCreditJpaRepository extends Repository<PortfolioCreditEntity, UUID> {

    @Query("select c from PortfolioCreditEntity c where c.userId = :userId order by c.sortOrder, c.createdAt, c.id")
    List<PortfolioCreditEntity> listOf(UUID userId);

    Optional<PortfolioCreditEntity> findByIdAndUserId(UUID id, UUID userId);

    long countByUserId(UUID userId);

    @Query("select c.id from PortfolioCreditEntity c where c.userId = :userId")
    List<UUID> idsOf(UUID userId);

    /** 맨 끝 순서를 같은 문장에서 센다. 부르는 쪽이 포트폴리오 행을 잡고 있다. */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            insert into PortfolioCreditEntity (id, userId, title, role, year, kind, sortOrder)
            select :id, :userId, :title, :role, :year, :kind, coalesce(max(c.sortOrder), -1) + 1
            from PortfolioCreditEntity c
            where c.userId = :userId
            """)
    int append(UUID id, UUID userId, String title, String role, int year, PortfolioCreditKind kind);

    /** {@code null} 인 항목은 그대로 둔다. */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            update PortfolioCreditEntity c
            set c.title = coalesce(:title, c.title),
                c.role = coalesce(:role, c.role),
                c.year = coalesce(:year, c.year),
                c.kind = coalesce(:kind, c.kind),
                c.updatedAt = instant
            where c.id = :id and c.userId = :userId
            """)
    int patch(UUID id, UUID userId, String title, String role, Integer year, PortfolioCreditKind kind);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("delete from PortfolioCreditEntity c where c.id = :id and c.userId = :userId")
    int deleteOwned(UUID id, UUID userId);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("update PortfolioCreditEntity c set c.sortOrder = :sortOrder where c.id = :id and c.userId = :userId")
    int moveTo(UUID id, UUID userId, int sortOrder);
}
