package com.acttub.actingapi.feature.community.adapter.db;

import java.util.UUID;

import com.acttub.actingapi.feature.community.schema.CommunityPostEntity;
import com.acttub.actingapi.platform.schema.ContentStatus;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;

interface CommunityPostJpaRepository extends JpaRepository<CommunityPostEntity, UUID> {
    boolean existsByIdAndStatus(UUID id, ContentStatus status);

    @Modifying
    @Query("""
            UPDATE CommunityPostEntity post
            SET post.title = :title,
                post.body = :body,
                post.updatedAt = CURRENT_TIMESTAMP
            WHERE post.id = :postId
            """)
    int updateContent(UUID postId, String title, String body);

    @Modifying
    @Query("""
            UPDATE CommunityPostEntity post
            SET post.status = :status,
                post.updatedAt = CURRENT_TIMESTAMP
            WHERE post.id = :postId
            """)
    int updateStatus(UUID postId, ContentStatus status);
}
