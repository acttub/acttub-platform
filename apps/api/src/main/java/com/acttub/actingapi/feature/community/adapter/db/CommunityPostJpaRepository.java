package com.acttub.actingapi.feature.community.adapter.db;

import java.util.Optional;
import java.util.UUID;

import com.acttub.actingapi.feature.community.schema.CommunityPostEntity;
import com.acttub.actingapi.platform.schema.ContentStatus;
import com.acttub.actingapi.platform.schema.ReportStatus;
import com.acttub.actingapi.platform.schema.ReportTargetType;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;

/** {@code community_posts} 를 읽고 쓰는 문장. 수를 바꾸는 문장은 읽고 쓰는 두 문장으로 풀지 않고 한 문장으로 둔다. */
interface CommunityPostJpaRepository extends JpaRepository<CommunityPostEntity, UUID> {
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            UPDATE CommunityPostEntity post
            SET post.title = :title,
                post.body = :body,
                post.updatedAt = CURRENT_TIMESTAMP
            WHERE post.id = :postId
            """)
    int updateContent(UUID postId, String title, String body);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            UPDATE CommunityPostEntity post
            SET post.status = :status,
                post.updatedAt = CURRENT_TIMESTAMP
            WHERE post.id = :postId
            """)
    int updateStatus(UUID postId, ContentStatus status);

    /** 글쓴이. {@code status} 인 글만 본다. */
    @Query("select post.authorId from CommunityPostEntity post where post.id = :postId and post.status = :status")
    Optional<UUID> authorWithStatus(UUID postId, ContentStatus status);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select post.authorId from CommunityPostEntity post where post.id = :postId and post.status = :status")
    Optional<UUID> lockAuthorWithStatus(UUID postId, ContentStatus status);

    /** 글쓴이. {@code status} 가 아닌 글만 본다. */
    @Query("select post.authorId from CommunityPostEntity post where post.id = :postId and post.status <> :status")
    Optional<UUID> authorWithoutStatus(UUID postId, ContentStatus status);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select post.authorId from CommunityPostEntity post where post.id = :postId and post.status <> :status")
    Optional<UUID> lockAuthorWithoutStatus(UUID postId, ContentStatus status);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select post.id from CommunityPostEntity post where post.id = :postId")
    Optional<UUID> lock(UUID postId);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("update CommunityPostEntity post set post.viewCount = post.viewCount + 1 where post.id = :postId")
    int incrementViewCount(UUID postId);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("update CommunityPostEntity post set post.commentCount = post.commentCount + 1 where post.id = :postId")
    int incrementCommentCount(UUID postId);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            update CommunityPostEntity post
            set post.commentCount = greatest(post.commentCount - 1, 0)
            where post.id = :postId
            """)
    int decrementCommentCount(UUID postId);

    /** 저장된 수에 더하지 않고 좋아요 행을 다시 센다. */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            update CommunityPostEntity post
            set post.likeCount = (
                select count(communityLike) from CommunityPostLikeEntity communityLike
                where communityLike.postId = post.id)
            where post.id = :postId
            """)
    int recountLikes(UUID postId);

    @Query("select post.likeCount from CommunityPostEntity post where post.id = :postId")
    Optional<Integer> likeCount(UUID postId);

    /** 서로 다른 {@code threshold} 명의 처리 전 신고가 모였으면 보이는 글을 가린다. updated_at 은 그대로다. */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            update CommunityPostEntity post
            set post.status = :hidden
            where post.id = :postId
              and post.status = :visible
              and (select count(distinct report.reporterId) from CommunityReportEntity report
                   where report.targetType = :targetType
                     and report.targetId = :postId
                     and report.status = :pending) >= :threshold
            """)
    int hideWhenReported(UUID postId, long threshold, ContentStatus hidden, ContentStatus visible,
            ReportTargetType targetType, ReportStatus pending);
}
