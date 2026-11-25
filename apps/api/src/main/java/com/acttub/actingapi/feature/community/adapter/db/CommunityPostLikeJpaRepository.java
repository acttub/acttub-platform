package com.acttub.actingapi.feature.community.adapter.db;

import java.util.UUID;

import com.acttub.actingapi.feature.community.schema.CommunityPostLikeEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

interface CommunityPostLikeJpaRepository extends JpaRepository<CommunityPostLikeEntity, UUID> {

    /** 이미 눌렀으면 0행이다. */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            insert into CommunityPostLikeEntity (id, postId, userId)
            values (:id, :postId, :userId)
            on conflict on constraint uq_community_post_likes do nothing
            """)
    int insertOnce(UUID id, UUID postId, UUID userId);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            DELETE FROM CommunityPostLikeEntity communityLike
            WHERE communityLike.postId = :postId
              AND communityLike.userId = :userId
            """)
    int deleteByPostAndUser(@Param("postId") UUID postId, @Param("userId") UUID userId);
}
