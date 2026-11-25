package com.acttub.actingapi.feature.community.adapter.db;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import com.acttub.actingapi.feature.community.schema.CommunityAnonymousAliasEntity;
import org.springframework.data.jpa.repository.Modifying;
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

    @Query("select alias.ordinal from CommunityAnonymousAliasEntity alias where alias.postId = :postId and alias.userId = :userId")
    Optional<Integer> ordinalOf(UUID postId, UUID userId);

    @Query("select coalesce(max(alias.ordinal), 0) + 1 from CommunityAnonymousAliasEntity alias where alias.postId = :postId")
    int nextOrdinal(UUID postId);

    /** 이미 번호가 있으면 그 행을 잡고 그대로 둔다. 어느 쪽이든 1행이다. */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            insert into CommunityAnonymousAliasEntity (id, postId, userId, ordinal)
            values (:id, :postId, :userId, :ordinal)
            on conflict on constraint uq_community_alias_post_user do update set userId = excluded.userId
            """)
    int insertOrKeep(UUID id, UUID postId, UUID userId, int ordinal);

    interface AliasProjection {
        UUID getUserId();

        int getOrdinal();
    }
}
