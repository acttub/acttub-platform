package com.acttub.actingapi.feature.auth.adapter.db;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

import com.acttub.actingapi.feature.auth.schema.RefreshTokenEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

interface RefreshTokenJpaRepository extends JpaRepository<RefreshTokenEntity, UUID> {

    Optional<RefreshTokenEntity> findByTokenHash(String tokenHash);

    @Query(value = """
            SELECT *
            FROM refresh_tokens
            WHERE token_hash = :tokenHash
            FOR UPDATE
            """, nativeQuery = true)
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
