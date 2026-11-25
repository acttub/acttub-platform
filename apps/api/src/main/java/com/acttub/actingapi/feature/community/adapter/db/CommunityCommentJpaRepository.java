package com.acttub.actingapi.feature.community.adapter.db;

import java.util.Optional;
import java.util.UUID;

import com.acttub.actingapi.feature.community.schema.CommunityCommentEntity;
import com.acttub.actingapi.platform.schema.ContentStatus;
import com.acttub.actingapi.platform.schema.ReportStatus;
import com.acttub.actingapi.platform.schema.ReportTargetType;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;

interface CommunityCommentJpaRepository extends JpaRepository<CommunityCommentEntity, UUID> {
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            UPDATE CommunityCommentEntity comment
            SET comment.status = :status,
                comment.updatedAt = CURRENT_TIMESTAMP
            WHERE comment.id = :commentId
            """)
    int updateStatus(UUID commentId, ContentStatus status);

    /** 지우려는 댓글을 잠가 읽는다. 작성자 행은 FK 로 늘 있어 조인하지 않는다. */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("""
            select comment.postId as postId, comment.authorId as authorId, comment.status as status
            from CommunityCommentEntity comment
            where comment.id = :commentId
            """)
    Optional<LockedComment> lockForDelete(UUID commentId);

    /** 글쓴이. {@code status} 가 아닌 댓글만 본다. */
    @Query("select comment.authorId from CommunityCommentEntity comment where comment.id = :commentId and comment.status <> :status")
    Optional<UUID> authorWithoutStatus(UUID commentId, ContentStatus status);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select comment.id from CommunityCommentEntity comment where comment.id = :commentId")
    Optional<UUID> lock(UUID commentId);

    /** 서로 다른 {@code threshold} 명의 처리 전 신고가 모였으면 보이는 댓글을 가린다. updated_at 은 그대로다. */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            update CommunityCommentEntity comment
            set comment.status = :hidden
            where comment.id = :commentId
              and comment.status = :visible
              and (select count(distinct report.reporterId) from CommunityReportEntity report
                   where report.targetType = :targetType
                     and report.targetId = :commentId
                     and report.status = :pending) >= :threshold
            """)
    int hideWhenReported(UUID commentId, long threshold, ContentStatus hidden, ContentStatus visible,
            ReportTargetType targetType, ReportStatus pending);

    interface LockedComment {
        UUID getPostId();

        UUID getAuthorId();

        ContentStatus getStatus();
    }
}
