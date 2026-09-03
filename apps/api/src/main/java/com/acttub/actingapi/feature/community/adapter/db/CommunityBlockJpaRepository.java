package com.acttub.actingapi.feature.community.adapter.db;

import java.util.UUID;

import com.acttub.actingapi.feature.community.schema.CommunityBlockEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

interface CommunityBlockJpaRepository extends JpaRepository<CommunityBlockEntity, UUID> {

    @Modifying
    @Query("""
            DELETE FROM CommunityBlockEntity communityBlock
            WHERE communityBlock.blockerId = :blockerId
              AND communityBlock.blockedId = :blockedId
            """)
    int deleteByPair(
            @Param("blockerId") UUID blockerId,
            @Param("blockedId") UUID blockedId);
}
