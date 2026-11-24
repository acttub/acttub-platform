package com.acttub.actingapi.feature.portfolio.adapter.db;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import com.acttub.actingapi.feature.portfolio.schema.PortfolioCreditEntity;
import com.acttub.actingapi.platform.schema.PortfolioCreditKind;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;

interface PortfolioCreditJpaRepository extends JpaRepository<PortfolioCreditEntity, UUID> {

    List<PortfolioCreditEntity> findByUserIdOrderBySortOrderAscCreatedAtAscIdAsc(UUID userId);

    List<PortfolioCreditEntity> findByUserId(UUID userId);

    Optional<PortfolioCreditEntity> findByIdAndUserId(UUID id, UUID userId);

    long countByUserId(UUID userId);

    /** 맨 끝 순서를 같은 문장에서 센다. 부르는 쪽이 포트폴리오 행을 잡고 있다. */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            INSERT INTO PortfolioCreditEntity(id, userId, title, role, year, kind, sortOrder)
            SELECT :id, :userId, :title, :role, :year, :kind, COALESCE(MAX(credit.sortOrder), -1) + 1
            FROM PortfolioCreditEntity credit
            WHERE credit.userId = :userId
            """)
    int append(UUID id, UUID userId, String title, String role, int year, PortfolioCreditKind kind);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            UPDATE PortfolioCreditEntity credit
            SET credit.title = COALESCE(:title, credit.title),
                credit.role = COALESCE(:role, credit.role),
                credit.year = COALESCE(:year, credit.year),
                credit.kind = COALESCE(:kind, credit.kind),
                credit.updatedAt = CURRENT_TIMESTAMP
            WHERE credit.id = :id AND credit.userId = :userId
            """)
    int patch(UUID id, UUID userId, String title, String role, Integer year, PortfolioCreditKind kind);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("DELETE FROM PortfolioCreditEntity credit WHERE credit.id = :id AND credit.userId = :userId")
    int deleteOwned(UUID id, UUID userId);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("UPDATE PortfolioCreditEntity credit SET credit.sortOrder = :sortOrder WHERE credit.id = :id AND credit.userId = :userId")
    int moveTo(UUID id, UUID userId, int sortOrder);
}
