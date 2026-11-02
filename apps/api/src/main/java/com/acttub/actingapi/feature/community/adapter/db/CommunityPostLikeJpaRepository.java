package com.acttub.actingapi.feature.community.adapter.db;

import java.util.UUID;

import com.acttub.actingapi.feature.community.schema.CommunityPostLikeEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

interface CommunityPostLikeJpaRepository extends JpaRepository<CommunityPostLikeEntity, UUID> {

    @Modifying
    @Query("""
            DELETE FROM CommunityPostLikeEntity communityLike
            WHERE communityLike.postId = :postId
              AND communityLike.userId = :userId
            """)
    int deleteByPostAndUser(@Param("postId") UUID postId, @Param("userId") UUID userId);
}
