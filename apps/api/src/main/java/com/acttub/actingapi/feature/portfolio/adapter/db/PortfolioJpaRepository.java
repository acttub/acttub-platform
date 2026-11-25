package com.acttub.actingapi.feature.portfolio.adapter.db;

import java.util.Optional;
import java.util.UUID;

import com.acttub.actingapi.feature.portfolio.domain.Portfolio;
import com.acttub.actingapi.feature.portfolio.schema.PortfolioEntity;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;

/** {@code portfolios} 를 읽고 쓰는 문장(apps/api/CONTRACT.md §5-9). */
interface PortfolioJpaRepository extends Repository<PortfolioEntity, UUID> {

    Optional<PortfolioEntity> findById(UUID userId);

    @Query("select p.userId from PortfolioEntity p where p.shareSlug = :slug and p.shareEnabled = true")
    Optional<UUID> sharedOwner(String slug);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("insert into PortfolioEntity (userId) values (:userId) on conflict (userId) do nothing")
    int createIfAbsent(UUID userId);

    /** 방언 덕에 {@code for update} 로 나간다(§5-2). */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select p.userId from PortfolioEntity p where p.userId = :userId")
    Optional<UUID> lock(UUID userId);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("update PortfolioEntity p set p.intro = :intro, p.updatedAt = instant where p.userId = :userId")
    int updateIntro(UUID userId, String intro);

    /** 처음 켤 때만 {@code newSlug} 를 쓴다. 이미 있으면 그대로 둔다. */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            update PortfolioEntity p
            set p.shareSlug = coalesce(p.shareSlug, case when :enabled = true then :newSlug end),
                p.shareEnabled = :enabled,
                p.updatedAt = instant
            where p.userId = :userId
            """)
    int updateShare(UUID userId, boolean enabled, String newSlug);

    @Query("""
            select new com.acttub.actingapi.feature.portfolio.domain.Portfolio$Share(p.shareEnabled, p.shareSlug)
            from PortfolioEntity p
            where p.userId = :userId
            """)
    Optional<Portfolio.Share> share(UUID userId);
}
