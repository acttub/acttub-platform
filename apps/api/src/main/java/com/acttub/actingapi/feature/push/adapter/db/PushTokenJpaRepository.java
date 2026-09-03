package com.acttub.actingapi.feature.push.adapter.db;

import java.util.UUID;

import com.acttub.actingapi.feature.push.schema.PushTokenEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

interface PushTokenJpaRepository extends JpaRepository<PushTokenEntity, UUID> {

    @Modifying
    @Query("""
            DELETE FROM PushTokenEntity token
            WHERE token.userId = :userId
              AND token.token = :token
            """)
    int deleteByOwnerAndToken(
            @Param("userId") UUID userId,
            @Param("token") String token);
}
