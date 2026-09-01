package com.acttub.actingapi.feature.community.adapter.db;

import java.util.UUID;

import com.acttub.actingapi.feature.community.schema.CommunityCommentEntity;
import com.acttub.actingapi.platform.schema.ContentStatus;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;

interface CommunityCommentJpaRepository extends JpaRepository<CommunityCommentEntity, UUID> {
    @Modifying
    @Query("""
            UPDATE CommunityCommentEntity comment
            SET comment.body = :body,
                comment.updatedAt = CURRENT_TIMESTAMP
            WHERE comment.id = :commentId
            """)
    int updateBody(UUID commentId, String body);

    @Modifying
    @Query("""
            UPDATE CommunityCommentEntity comment
            SET comment.status = :status,
                comment.updatedAt = CURRENT_TIMESTAMP
            WHERE comment.id = :commentId
            """)
    int updateStatus(UUID commentId, ContentStatus status);
}
