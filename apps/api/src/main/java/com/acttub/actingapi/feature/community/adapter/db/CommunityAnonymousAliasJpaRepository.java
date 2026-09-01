package com.acttub.actingapi.feature.community.adapter.db;

import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.community.schema.CommunityAnonymousAliasEntity;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;

interface CommunityAnonymousAliasJpaRepository
        extends Repository<CommunityAnonymousAliasEntity, UUID> {
    @Query("""
            SELECT alias.userId AS userId, alias.ordinal AS ordinal
            FROM CommunityAnonymousAliasEntity alias
            WHERE alias.postId = :postId
            """)
    List<AliasProjection> findAliasesByPostId(UUID postId);

    interface AliasProjection {
        UUID getUserId();

        int getOrdinal();
    }
}
