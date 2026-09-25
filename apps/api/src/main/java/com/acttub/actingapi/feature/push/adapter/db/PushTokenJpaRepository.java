package com.acttub.actingapi.feature.push.adapter.db;

import java.util.UUID;

import com.acttub.actingapi.feature.push.schema.PushTokenEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

interface PushTokenJpaRepository extends JpaRepository<PushTokenEntity, UUID> {

    /** 주인을 따지지 않는다 — 푸시 토큰을 갖고 있다는 것이 본인 확인이다(apps/api/CONTRACT.md §6-10). */
    @Modifying
    @Query("""
            DELETE FROM PushTokenEntity token
            WHERE token.token = :token
            """)
    int deleteByToken(@Param("token") String token);
}
