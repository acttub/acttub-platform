package com.acttub.actingapi.feature.community.adapter.db;

import static com.acttub.actingapi.platform.schema.NativeTuples.list;

import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;

import com.acttub.actingapi.feature.community.app.CommunityContentNotFound;
import com.acttub.actingapi.feature.community.app.CommunityRepository;
import com.acttub.actingapi.feature.community.app.DuplicateReport;
import com.acttub.actingapi.feature.community.app.InvalidCursor;
import com.acttub.actingapi.feature.community.app.NotAuthor;
import com.acttub.actingapi.feature.community.app.Page;
import com.acttub.actingapi.feature.community.app.ReportingOwnContent;
import com.acttub.actingapi.feature.community.domain.BlockedUser;
import com.acttub.actingapi.feature.community.domain.CommunityCategory;
import com.acttub.actingapi.feature.community.domain.CommunityComment;
import com.acttub.actingapi.feature.community.domain.CommunityPost;
import com.acttub.actingapi.feature.community.schema.CommunityCommentEntity;
import com.acttub.actingapi.feature.community.schema.CommunityPostEntity;
import com.acttub.actingapi.feature.community.schema.CommunityReportEntity;
import com.acttub.actingapi.platform.schema.ContentStatus;
import com.acttub.actingapi.platform.schema.ReportReason;
import com.acttub.actingapi.platform.schema.ReportStatus;
import com.acttub.actingapi.platform.schema.ReportTargetType;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Query;
import jakarta.persistence.Tuple;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Community 포트를 Spring Data JPA와 PostgreSQL native SQL로 구현한다.
 *
 * <p><b>트랜잭션 경계가 이 클래스 안에 있다.</b> 없음·소유권 판정과 그에 따른 쓰기가 한 트랜잭션·
 * 한 잠금 안에서 끝나야 하므로, 서비스가 조회와 쓰기를 따로 부르는 형태로 가르지 않았다.
 * `RETURNING`·`ON CONFLICT`·행 잠금·컬럼식 증감은 기존 원자성을 지키기 위해 native SQL로 남긴다.
 */
@Repository
class PostgresCommunityRepository implements CommunityRepository {
    private static final int DEFAULT_PAGE_SIZE = 20;
    private static final int MAX_PAGE_SIZE = 50;
    private static final String POST_COLUMNS = """
            p.id AS id,
            p.author_id AS author_id,
            p.anonymous AS anonymous,
            category.slug AS category_slug,
            category.name AS category_name,
            CASE WHEN author.status = 'deactivated'
                 THEN '탈퇴한 사용자'
                 ELSE author.nickname END AS author_nickname,
            p.title AS title,
            p.body AS body,
            p.like_count AS like_count,
            p.comment_count AS comment_count,
            p.view_count AS view_count,
            p.created_at AS created_at,
            p.updated_at AS updated_at
            """;
    private static final String COMMENT_COLUMNS = """
            comment.id AS id,
            comment.post_id AS post_id,
            comment.author_id AS author_id,
            comment.anonymous AS anonymous,
            CASE WHEN author.status = 'deactivated'
                 THEN '탈퇴한 사용자'
                 ELSE author.nickname END AS author_nickname,
            comment.body AS body,
            comment.created_at AS created_at,
            comment.updated_at AS updated_at
            """;

    private final CommunityCategoryJpaRepository categories;
    private final CommunityPostJpaRepository posts;
    private final CommunityCommentJpaRepository comments;
    private final CommunityPostLikeJpaRepository likes;
    private final CommunityBlockJpaRepository blocks;
    private final CommunityReportJpaRepository reports;
    private final EntityManager entityManager;
    private final TransactionTemplate transaction;
    private final AnonymousAliasAllocator aliases;

    PostgresCommunityRepository(
            CommunityCategoryJpaRepository categories,
            CommunityPostJpaRepository posts,
            CommunityCommentJpaRepository comments,
            CommunityPostLikeJpaRepository likes,
            CommunityBlockJpaRepository blocks,
            CommunityReportJpaRepository reports,
            EntityManager entityManager,
            PlatformTransactionManager transactionManager,
            AnonymousAliasAllocator aliases) {
        this.categories = categories;
        this.posts = posts;
        this.comments = comments;
        this.likes = likes;
        this.blocks = blocks;
        this.reports = reports;
        this.entityManager = entityManager;
        this.transaction = new TransactionTemplate(transactionManager);
        this.aliases = aliases;
    }

    @Override
    public List<CommunityCategory> listCategories() {
        return categories.findByActiveTrueOrderBySortOrderAscSlugAsc().stream()
                .map(category -> new CommunityCategory(
                        category.getSlug(),
                        category.getName(),
                        category.getDescription()))
                .toList();
    }

    @Override
    public Page<CommunityPost> listPosts(
            UUID viewerId, String categorySlug, String cursor, Integer limit) {
        int size = clampLimit(limit);
        CommunityVisibilitySpecification.Fragment visibility =
                CommunityVisibilitySpecification.notBlocked("p", viewerId);
        Map<String, Object> parameters = new HashMap<>(visibility.parameters());
        parameters.put("fetchLimit", size + 1);

        StringBuilder where = new StringBuilder("""
                p.status = 'visible'
                AND %s
                """.formatted(visibility.sql()).strip());
        if (categorySlug != null) {
            where.append("\nAND category.slug = :categorySlug");
            parameters.put("categorySlug", categorySlug);
        }
        if (cursor != null) {
            CommunityCursor.Cursor decoded = decodeCursor(cursor);
            where.append("""

                    AND (p.created_at < :cursorCreatedAt
                         OR (p.created_at = :cursorCreatedAt AND p.id < :cursorId))
                    """);
            parameters.put("cursorCreatedAt", decoded.createdAt());
            parameters.put("cursorId", decoded.id());
        }

        String viewerColumns = viewerId == null
                ? "FALSE AS liked_by_me"
                : """
                  EXISTS (
                      SELECT 1 FROM community_post_likes viewer_like
                      WHERE viewer_like.post_id = p.id AND viewer_like.user_id = :viewerId
                  ) AS liked_by_me
                  """;
        List<CommunityPost> rows = list(tupleQuery("""
                SELECT %s,
                       %s
                FROM community_posts p
                JOIN community_categories category ON category.id = p.category_id
                JOIN users author ON author.id = p.author_id
                WHERE %s
                ORDER BY p.created_at DESC, p.id DESC
                LIMIT :fetchLimit
                """.formatted(POST_COLUMNS, viewerColumns, where), parameters)).stream()
                .map(row -> post(row, viewerId))
                .toList();

        boolean hasMore = rows.size() > size;
        List<CommunityPost> items = hasMore ? List.copyOf(rows.subList(0, size)) : List.copyOf(rows);
        String nextCursor = hasMore && !items.isEmpty()
                ? CommunityCursor.encode(items.getLast().createdAt(), items.getLast().id())
                : null;
        return new Page<>(items, nextCursor);
    }

    @Override
    public CommunityPost getPost(UUID postId, UUID viewerId) {
        return loadVisiblePost(postId, viewerId);
    }

    @Override
    public CommunityPost createPost(
            UUID authorId,
            String categorySlug,
            String title,
            String body,
            boolean anonymous) {
        return required(transaction.execute(status -> {
            UUID categoryId = categories.findBySlugAndActiveTrue(categorySlug)
                    .map(category -> category.getId())
                    .orElseThrow(CommunityContentNotFound::new);
            UUID id = UUID.randomUUID();
            posts.saveAndFlush(new CommunityPostEntity(
                    id,
                    categoryId,
                    authorId,
                    title,
                    body,
                    anonymous,
                    ContentStatus.VISIBLE));
            return justInserted(id, authorId);
        }));
    }

    /**
     * 방금 넣은 글을 응답에 실을 형태로 다시 읽는다.
     *
     * <p>🔥 <b>없으면 {@link CommunityContentNotFound}가 아니다.</b> 이 자리의 "없음"은 분류가
     * 없다는 뜻이 아니라 방금 넣은 행이 조회 조건에 안 걸린다는 뜻이고(작성자가 자기 자신을
     * 차단한 행이 남아 있으면 그렇게 된다), 서비스가 그것을 {@code category_not_found}로 옮기면
     * 멀쩡한 분류를 탓하게 된다. 종전에도 이 자리는 컨트롤러 catch를 비껴 500이었다.
     */
    private CommunityPost justInserted(UUID postId, UUID authorId) {
        try {
            return loadVisiblePost(postId, authorId);
        } catch (CommunityContentNotFound exception) {
            throw new IllegalStateException(
                    "community post is not visible right after insert", exception);
        }
    }

    @Override
    public CommunityPost updatePost(UUID postId, UUID authorId, String title, String body) {
        return required(transaction.execute(status -> {
            OwnedPost owned = ownedPost(postId, true, false);
            if (owned == null) {
                throw new CommunityContentNotFound();
            }
            if (!owned.authorId().equals(authorId)) {
                throw new NotAuthor();
            }
            entityManager.createNativeQuery("""
                    UPDATE community_posts
                    SET title = :title, body = :body, updated_at = now()
                    WHERE id = :postId
                    """)
                    .setParameter("title", title)
                    .setParameter("body", body)
                    .setParameter("postId", postId)
                    .executeUpdate();
            return loadVisiblePost(postId, authorId);
        }));
    }

    @Override
    public void deletePost(UUID postId, UUID authorId) {
        transaction.executeWithoutResult(status -> {
            OwnedPost owned = ownedPost(postId, false, true);
            if (owned == null) {
                throw new CommunityContentNotFound();
            }
            if (!owned.authorId().equals(authorId)) {
                throw new NotAuthor();
            }
            entityManager.createNativeQuery("""
                    UPDATE community_posts
                    SET status = 'deleted', updated_at = now()
                    WHERE id = :postId
                    """)
                    .setParameter("postId", postId)
                    .executeUpdate();
        });
    }

    @Override
    public void incrementViewCount(UUID postId) {
        transaction.executeWithoutResult(status -> entityManager.createNativeQuery("""
                UPDATE community_posts
                SET view_count = view_count + 1
                WHERE id = :postId
                """)
                .setParameter("postId", postId)
                .executeUpdate());
    }

    @Override
    public int likePost(UUID postId, UUID userId) {
        return required(transaction.execute(status -> {
            requireVisiblePost(postId);
            list(entityManager.createNativeQuery("""
                    WITH inserted AS (
                        INSERT INTO community_post_likes (id,post_id,user_id)
                        VALUES (:id,:postId,:userId)
                        ON CONFLICT ON CONSTRAINT uq_community_post_likes DO NOTHING
                        RETURNING id
                    )
                    SELECT id AS id FROM inserted
                    """, Tuple.class)
                    .setParameter("id", UUID.randomUUID())
                    .setParameter("postId", postId)
                    .setParameter("userId", userId));
            return resyncLikeCount(postId);
        }));
    }

    @Override
    public int unlikePost(UUID postId, UUID userId) {
        return required(transaction.execute(status -> {
            requireVisiblePost(postId);
            likes.deleteByPostAndUser(postId, userId);
            return resyncLikeCount(postId);
        }));
    }

    @Override
    public Page<CommunityComment> listComments(
            UUID postId,
            UUID viewerId,
            String cursor,
            Integer limit) {
        // 글 조회가 커서 해독보다 먼저다. 순서를 바꾸면 "없는 글 + 깨진 커서"가 404 대신 400이다.
        CommunityPost parent = loadVisiblePost(postId, viewerId);
        int size = clampLimit(limit);
        CommunityVisibilitySpecification.Fragment visibility =
                CommunityVisibilitySpecification.notBlocked("comment", viewerId);
        Map<String, Object> parameters = new HashMap<>(visibility.parameters());
        parameters.put("postId", postId);
        parameters.put("fetchLimit", size + 1);
        StringBuilder cursorClause = new StringBuilder();
        if (cursor != null) {
            CommunityCursor.Cursor decoded = decodeCursor(cursor);
            cursorClause.append("""
                    AND (comment.created_at > :cursorCreatedAt
                         OR (comment.created_at = :cursorCreatedAt AND comment.id > :cursorId))
                    """);
            parameters.put("cursorCreatedAt", decoded.createdAt());
            parameters.put("cursorId", decoded.id());
        }

        List<CommunityComment> rows = list(tupleQuery("""
                SELECT %s
                FROM community_comments comment
                JOIN users author ON author.id = comment.author_id
                WHERE comment.post_id = :postId
                  AND comment.status = 'visible'
                  AND %s
                  %s
                ORDER BY comment.created_at ASC, comment.id ASC
                LIMIT :fetchLimit
                """.formatted(COMMENT_COLUMNS, visibility.sql(), cursorClause), parameters)).stream()
                .map(row -> comment(row, viewerId))
                .toList();

        boolean hasMore = rows.size() > size;
        List<CommunityComment> page = hasMore ? rows.subList(0, size) : rows;
        List<CommunityComment> items = named(parent, page, aliasMap(postId));
        String nextCursor = hasMore && !items.isEmpty()
                ? CommunityCursor.encode(items.getLast().createdAt(), items.getLast().id())
                : null;
        return new Page<>(items, nextCursor);
    }

    @Override
    public CommunityComment createComment(
            UUID postId,
            UUID authorId,
            String body,
            boolean anonymous) {
        return required(transaction.execute(status -> {
            CommunityPost parent = loadVisiblePost(postId, null);
            if (anonymous && !parent.writtenAnonymouslyBy(authorId)) {
                aliases.ensureAlias(postId, authorId);
            }
            UUID id = UUID.randomUUID();
            comments.saveAndFlush(new CommunityCommentEntity(
                    id,
                    postId,
                    authorId,
                    body,
                    anonymous,
                    ContentStatus.VISIBLE));
            entityManager.createNativeQuery("""
                    UPDATE community_posts
                    SET comment_count = comment_count + 1
                    WHERE id = :postId
                    """)
                    .setParameter("postId", postId)
                    .executeUpdate();
            CommunityComment created = loadComment(id, authorId);
            return created.named(parent, aliasMap(postId).get(created.authorId()));
        }));
    }

    @Override
    public CommunityComment updateComment(UUID commentId, UUID authorId, String body) {
        return required(transaction.execute(status -> {
            CommunityComment existing = loadComment(commentId, authorId);
            if (existing == null || !existing.isVisible()) {
                throw new CommunityContentNotFound();
            }
            if (!existing.authorId().equals(authorId)) {
                throw new NotAuthor();
            }
            entityManager.createNativeQuery("""
                    UPDATE community_comments
                    SET body = :body, updated_at = now()
                    WHERE id = :commentId
                    """)
                    .setParameter("body", body)
                    .setParameter("commentId", commentId)
                    .executeUpdate();
            CommunityComment updated = loadComment(commentId, authorId);
            CommunityPost parent = parentPostOf(updated);
            return updated.named(parent, aliasMap(updated.postId()).get(updated.authorId()));
        }));
    }

    @Override
    public void deleteComment(UUID commentId, UUID authorId) {
        transaction.executeWithoutResult(status -> {
            List<CommunityComment> rows = list(entityManager.createNativeQuery("""
                    SELECT %s,
                           comment.status AS status
                    FROM community_comments comment
                    JOIN users author ON author.id = comment.author_id
                    WHERE comment.id = :commentId
                    FOR UPDATE OF comment
                    """.formatted(COMMENT_COLUMNS), Tuple.class)
                    .setParameter("commentId", commentId)).stream()
                    .map(row -> commentWithStatus(row, null))
                    .toList();
            if (rows.isEmpty() || rows.getFirst().isDeleted()) {
                throw new CommunityContentNotFound();
            }
            CommunityComment existing = rows.getFirst();
            if (!existing.authorId().equals(authorId)) {
                throw new NotAuthor();
            }
            entityManager.createNativeQuery("""
                    UPDATE community_comments
                    SET status = 'deleted', updated_at = now()
                    WHERE id = :commentId
                    """)
                    .setParameter("commentId", commentId)
                    .executeUpdate();
            entityManager.createNativeQuery("""
                    UPDATE community_posts
                    SET comment_count = GREATEST(comment_count - 1, 0)
                    WHERE id = :postId
                    """)
                    .setParameter("postId", existing.postId())
                    .executeUpdate();
        });
    }

    @Override
    public void createReport(
            UUID reporterId,
            String targetType,
            UUID targetId,
            String reason,
            String detail) {
        transaction.executeWithoutResult(status -> {
            ReportTargetType target = enumValue(ReportTargetType.class, targetType);
            String table = target == ReportTargetType.POST
                    ? "community_posts"
                    : "community_comments";
            List<Tuple> authors = list(entityManager.createNativeQuery("""
                    SELECT author_id AS author_id
                    FROM %s
                    WHERE id = :targetId AND status <> 'deleted'
                    """.formatted(table), Tuple.class)
                    .setParameter("targetId", targetId));
            if (authors.isEmpty()) {
                throw new CommunityContentNotFound();
            }
            if (authors.getFirst().get("author_id", UUID.class).equals(reporterId)) {
                throw new ReportingOwnContent();
            }
            try {
                reports.saveAndFlush(new CommunityReportEntity(
                        UUID.randomUUID(),
                        reporterId,
                        target,
                        targetId,
                        enumValue(ReportReason.class, reason),
                        detail,
                        ReportStatus.PENDING));
            } catch (DataIntegrityViolationException exception) {
                throw new DuplicateReport(exception);
            }
        });
    }

    @Override
    public List<BlockedUser> listBlocks(UUID blockerId) {
        return list(entityManager.createNativeQuery("""
                SELECT blocked.id AS id, blocked.nickname AS nickname
                FROM users blocked
                JOIN community_blocks community_block
                  ON community_block.blocked_id = blocked.id
                WHERE community_block.blocker_id = :blockerId
                ORDER BY community_block.created_at DESC
                """, Tuple.class)
                .setParameter("blockerId", blockerId)).stream()
                .map(row -> new BlockedUser(
                        row.get("id", UUID.class),
                        row.get("nickname", String.class)))
                .toList();
    }

    @Override
    public void blockUser(UUID blockerId, UUID blockedId) {
        transaction.executeWithoutResult(status -> {
            if (!userExists(blockedId)) {
                throw new CommunityContentNotFound();
            }
            list(entityManager.createNativeQuery("""
                    WITH inserted AS (
                        INSERT INTO community_blocks (id,blocker_id,blocked_id)
                        VALUES (:id,:blockerId,:blockedId)
                        ON CONFLICT ON CONSTRAINT uq_community_blocks_pair DO NOTHING
                        RETURNING id
                    )
                    SELECT id AS id FROM inserted
                    """, Tuple.class)
                    .setParameter("id", UUID.randomUUID())
                    .setParameter("blockerId", blockerId)
                    .setParameter("blockedId", blockedId));
        });
    }

    @Override
    public void unblockUser(UUID blockerId, UUID blockedId) {
        transaction.executeWithoutResult(status -> blocks.deleteByPair(blockerId, blockedId));
    }

    private CommunityPost loadVisiblePost(UUID postId, UUID viewerId) {
        CommunityVisibilitySpecification.Fragment visibility =
                CommunityVisibilitySpecification.notBlocked("p", viewerId);
        Map<String, Object> parameters = new HashMap<>(visibility.parameters());
        parameters.put("postId", postId);
        String viewerColumn = viewerId == null
                ? "FALSE AS liked_by_me"
                : """
                  EXISTS (
                      SELECT 1 FROM community_post_likes viewer_like
                      WHERE viewer_like.post_id = p.id AND viewer_like.user_id = :viewerId
                  ) AS liked_by_me
                  """;
        List<CommunityPost> rows = list(tupleQuery("""
                SELECT %s,
                       %s
                FROM community_posts p
                JOIN community_categories category ON category.id = p.category_id
                JOIN users author ON author.id = p.author_id
                WHERE p.id = :postId
                  AND p.status = 'visible'
                  AND %s
                """.formatted(POST_COLUMNS, viewerColumn, visibility.sql()), parameters)).stream()
                .map(row -> post(row, viewerId))
                .toList();
        if (rows.isEmpty()) {
            throw new CommunityContentNotFound();
        }
        return rows.getFirst();
    }

    /** 댓글이 달린 글. 지워졌든 차단됐든 가리지 않고 읽으며, 없으면 FK 불변식 오류다. */
    private CommunityPost parentPostOf(CommunityComment comment) {
        List<CommunityPost> rows = list(entityManager.createNativeQuery("""
                SELECT %s,
                       FALSE AS liked_by_me
                FROM community_posts p
                JOIN community_categories category ON category.id = p.category_id
                JOIN users author ON author.id = p.author_id
                WHERE p.id = :postId
                """.formatted(POST_COLUMNS), Tuple.class)
                .setParameter("postId", comment.postId())).stream()
                .map(row -> post(row, null))
                .toList();
        if (rows.isEmpty()) {
            throw new IllegalStateException("community post is missing");
        }
        return rows.getFirst();
    }

    private OwnedPost ownedPost(UUID postId, boolean visibleOnly, boolean lock) {
        String status = visibleOnly
                ? "AND status = 'visible'"
                : "AND status <> 'deleted'";
        String lockClause = lock ? "FOR UPDATE" : "";
        List<Tuple> rows = list(entityManager.createNativeQuery("""
                SELECT author_id AS author_id
                FROM community_posts
                WHERE id = :postId %s
                %s
                """.formatted(status, lockClause), Tuple.class)
                .setParameter("postId", postId));
        return rows.isEmpty()
                ? null
                : new OwnedPost(rows.getFirst().get("author_id", UUID.class));
    }

    private void requireVisiblePost(UUID postId) {
        List<Tuple> rows = list(entityManager.createNativeQuery("""
                SELECT id AS id
                FROM community_posts
                WHERE id = :postId AND status = 'visible'
                """, Tuple.class)
                .setParameter("postId", postId));
        if (rows.isEmpty()) {
            throw new CommunityContentNotFound();
        }
    }

    private int resyncLikeCount(UUID postId) {
        List<Tuple> counts = list(entityManager.createNativeQuery("""
                WITH changed AS (
                    UPDATE community_posts AS like_count_post
                    SET like_count = (
                        SELECT COUNT(*)
                        FROM community_post_likes community_like
                        WHERE community_like.post_id = like_count_post.id
                    )
                    WHERE like_count_post.id = :postId
                    RETURNING like_count
                )
                SELECT like_count AS like_count FROM changed
                """, Tuple.class)
                .setParameter("postId", postId));
        if (counts.isEmpty()) {
            throw new CommunityContentNotFound();
        }
        return counts.getFirst().get("like_count", Integer.class);
    }

    private CommunityComment loadComment(UUID commentId, UUID viewerId) {
        List<CommunityComment> rows = list(entityManager.createNativeQuery("""
                SELECT %s,
                       comment.status AS status
                FROM community_comments comment
                JOIN users author ON author.id = comment.author_id
                WHERE comment.id = :commentId
                """.formatted(COMMENT_COLUMNS), Tuple.class)
                .setParameter("commentId", commentId)).stream()
                .map(row -> commentWithStatus(row, viewerId))
                .toList();
        return rows.isEmpty() ? null : rows.getFirst();
    }

    private Map<UUID, Integer> aliasMap(UUID postId) {
        Map<UUID, Integer> result = new HashMap<>();
        list(entityManager.createNativeQuery("""
                SELECT user_id AS user_id, ordinal AS ordinal
                FROM community_anonymous_aliases
                WHERE post_id = :postId
                """, Tuple.class)
                .setParameter("postId", postId)).forEach(row -> result.put(
                        row.get("user_id", UUID.class),
                        row.get("ordinal", Integer.class)));
        return result;
    }

    private boolean userExists(UUID userId) {
        return !list(entityManager.createNativeQuery("""
                SELECT id AS id
                FROM users
                WHERE id = :userId
                """, Tuple.class)
                .setParameter("userId", userId)).isEmpty();
    }

    private Query tupleQuery(String sql, Map<String, ?> parameters) {
        Query query = entityManager.createNativeQuery(sql, Tuple.class);
        parameters.forEach(query::setParameter);
        return query;
    }

    /** 익명 댓글에 표시 이름을 붙인다. 무엇으로 붙일지는 Domain Model이 안다. */
    private static List<CommunityComment> named(
            CommunityPost post,
            List<CommunityComment> comments,
            Map<UUID, Integer> aliases) {
        return comments.stream()
                .map(comment -> comment.named(post, aliases.get(comment.authorId())))
                .toList();
    }

    private static CommunityPost post(Tuple row, UUID viewerId) {
        UUID authorId = row.get("author_id", UUID.class);
        return new CommunityPost(
                row.get("id", UUID.class),
                authorId,
                row.get("anonymous", Boolean.class),
                row.get("category_slug", String.class),
                row.get("category_name", String.class),
                row.get("author_nickname", String.class),
                row.get("title", String.class),
                row.get("body", String.class),
                row.get("like_count", Integer.class),
                row.get("comment_count", Integer.class),
                row.get("view_count", Integer.class),
                row.get("liked_by_me", Boolean.class),
                viewerId != null && viewerId.equals(authorId),
                utc(row, "created_at"),
                utc(row, "updated_at"));
    }

    private static CommunityComment comment(Tuple row, UUID viewerId) {
        UUID authorId = row.get("author_id", UUID.class);
        return CommunityComment.visible(
                row.get("id", UUID.class),
                row.get("post_id", UUID.class),
                authorId,
                row.get("anonymous", Boolean.class),
                row.get("author_nickname", String.class),
                row.get("body", String.class),
                viewerId != null && viewerId.equals(authorId),
                utc(row, "created_at"),
                utc(row, "updated_at"));
    }

    private static CommunityComment commentWithStatus(Tuple row, UUID viewerId) {
        return comment(row, viewerId).withStatus(row.get("status", String.class));
    }

    private static OffsetDateTime utc(Tuple row, String alias) {
        return row.get(alias, Instant.class).atOffset(ZoneOffset.UTC);
    }

    private static CommunityCursor.Cursor decodeCursor(String cursor) {
        try {
            return CommunityCursor.decode(cursor);
        } catch (IllegalArgumentException exception) {
            throw new InvalidCursor();
        }
    }

    private static int clampLimit(Integer limit) {
        if (limit == null) {
            return DEFAULT_PAGE_SIZE;
        }
        return Math.max(1, Math.min(limit, MAX_PAGE_SIZE));
    }

    private static <E extends Enum<E>> E enumValue(Class<E> type, String value) {
        return Enum.valueOf(type, value.toUpperCase(Locale.ROOT));
    }

    private static <T> T required(T value) {
        return Objects.requireNonNull(value, "transaction returned no value");
    }

    private record OwnedPost(UUID authorId) {
    }
}
