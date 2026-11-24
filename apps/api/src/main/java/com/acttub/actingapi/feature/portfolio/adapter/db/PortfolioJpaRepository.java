package com.acttub.actingapi.feature.portfolio.adapter.db;

import java.util.Optional;
import java.util.UUID;

import com.acttub.actingapi.feature.portfolio.schema.PortfolioEntity;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;

interface PortfolioJpaRepository extends JpaRepository<PortfolioEntity, UUID> {

    Optional<PortfolioEntity> findByShareSlugAndShareEnabledTrue(String slug);

    /** Hibernate 의 PostgreSQL 방언은 이것을 FOR NO KEY UPDATE 로 낸다(SOMA-1112 P01·P37). */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT portfolio FROM PortfolioEntity portfolio WHERE portfolio.userId = :userId")
    Optional<PortfolioEntity> lock(UUID userId);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("INSERT INTO PortfolioEntity(userId) VALUES (:userId) ON CONFLICT(userId) DO NOTHING")
    int createIfAbsent(UUID userId);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            UPDATE PortfolioEntity portfolio
            SET portfolio.intro = :intro,
                portfolio.updatedAt = CURRENT_TIMESTAMP
            WHERE portfolio.userId = :userId
            """)
    int updateIntro(UUID userId, String intro);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            UPDATE PortfolioEntity portfolio
            SET portfolio.shareSlug = COALESCE(portfolio.shareSlug, CASE WHEN :enabled = TRUE THEN :newSlug END),
                portfolio.shareEnabled = :enabled,
                portfolio.updatedAt = CURRENT_TIMESTAMP
            WHERE portfolio.userId = :userId
            """)
    int updateShare(UUID userId, boolean enabled, String newSlug);
}
