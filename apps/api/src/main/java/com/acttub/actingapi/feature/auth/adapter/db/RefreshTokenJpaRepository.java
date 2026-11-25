package com.acttub.actingapi.feature.auth.adapter.db;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

import com.acttub.actingapi.feature.auth.schema.RefreshTokenEntity;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

interface RefreshTokenJpaRepository extends JpaRepository<RefreshTokenEntity, UUID> {

    Optional<RefreshTokenEntity> findByTokenHash(String tokenHash);

    /** 판정과 교체가 이 잠금 안에서 난다. 방언 덕에 {@code FOR UPDATE} 로 나간다(apps/api/CONTRACT.md §5-2). */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select token from RefreshTokenEntity token where token.tokenHash = :tokenHash")
    Optional<RefreshTokenEntity> findByTokenHashForUpdate(
            @Param("tokenHash") String tokenHash);

    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("""
            UPDATE RefreshTokenEntity token
            SET token.revokedAt = :now
            WHERE token.userId = :userId
              AND token.revokedAt IS NULL
            """)
    int revokeAllActiveByUserId(
            @Param("userId") UUID userId,
            @Param("now") Instant now);

    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("""
            UPDATE RefreshTokenEntity token
            SET token.revokedAt = :now
            WHERE token.tokenHash = :tokenHash
              AND token.revokedAt IS NULL
            """)
    int revokeActiveByTokenHash(
            @Param("tokenHash") String tokenHash,
            @Param("now") Instant now);
}
