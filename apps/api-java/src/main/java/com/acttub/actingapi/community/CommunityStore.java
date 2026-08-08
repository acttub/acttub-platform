package com.acttub.actingapi.community;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;

import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.support.TransactionTemplate;

@Repository
class CommunityStore {
    private static final int DEFAULT_PAGE_SIZE = 20;
    private static final int MAX_PAGE_SIZE = 50;

    private final JdbcTemplate jdbc;
    private final NamedParameterJdbcTemplate namedJdbc;
    private final TransactionTemplate transaction;
    private final AnonymousAliasAllocator aliases;

    CommunityStore(
            JdbcTemplate jdbc,
            TransactionTemplate transaction,
            AnonymousAliasAllocator aliases) {
        this.jdbc = jdbc;
        this.namedJdbc = new NamedParameterJdbcTemplate(jdbc);
        this.transaction = transaction;
        this.aliases = aliases;
    }

    List<Category> listCategories() {
        return jdbc.query("""
                SELECT slug, name, description
                FROM community_categories
                WHERE is_active = TRUE
                ORDER BY sort_order, slug
                """, (result, rowNumber) -> new Category(
                result.getString("slug"),
                result.getString("name"),
                result.getString("description")));
    }

    Page<Post> listPosts(UUID viewerId, String categorySlug, String cursor, Integer limit) {
        int size = clampLimit(limit);
        CommunityVisibilitySpecification.Fragment visibility =
                CommunityVisibilitySpecification.notBlocked("p", viewerId);
        MapSqlParameterSource parameters = new MapSqlParameterSource()
                .addValues(visibility.parameters())
                .addValue("fetchLimit", size + 1);

        StringBuilder where = new StringBuilder("""
                p.status = 'visible'::content_status_t
                AND %s
                """.formatted(visibility.sql()).strip());
        if (categorySlug != null) {
            where.append("\nAND category.slug = :categorySlug");
            parameters.addValue("categorySlug", categorySlug);
        }
        if (cursor != null) {
            CommunityCursor.Cursor decoded = CommunityCursor.decode(cursor);
            where.append("""

                    AND (p.created_at < :cursorCreatedAt
                         OR (p.created_at = :cursorCreatedAt AND p.id < :cursorId))
                    """);
            parameters.addValue("cursorCreatedAt", decoded.createdAt());
            parameters.addValue("cursorId", decoded.id());
        }

        String viewerColumns = viewerId == null
                ? "FALSE AS liked_by_me"
                : """
                  EXISTS (
                      SELECT 1 FROM community_post_likes viewer_like
                      WHERE viewer_like.post_id = p.id AND viewer_like.user_id = :viewerId
                  ) AS liked_by_me
                  """;
        List<Post> rows = namedJdbc.query("""
                SELECT p.id,
                       p.author_id,
                       p.anonymous,
                       category.slug AS category_slug,
                       category.name AS category_name,
                       author.nickname AS author_nickname,
                       p.title,
                       p.body,
                       p.like_count,
                       p.comment_count,
                       p.view_count,
                       p.created_at,
                       p.updated_at,
                       %s
                FROM community_posts p
                JOIN community_categories category ON category.id = p.category_id
                JOIN users author ON author.id = p.author_id
                WHERE %s
                ORDER BY p.created_at DESC, p.id DESC
                LIMIT :fetchLimit
                """.formatted(viewerColumns, where), parameters,
                (result, rowNumber) -> post(result, viewerId));

        boolean hasMore = rows.size() > size;
        List<Post> items = hasMore ? List.copyOf(rows.subList(0, size)) : List.copyOf(rows);
        String nextCursor = hasMore && !items.isEmpty()
                ? CommunityCursor.encode(items.getLast().createdAt(), items.getLast().id())
                : null;
        return new Page<>(items, nextCursor);
    }

    Post getPost(UUID postId, UUID viewerId) {
        return loadVisiblePost(postId, viewerId);
    }

    Post createPost(
            UUID authorId,
            String categorySlug,
            String title,
            String body,
            boolean anonymous) {
        return required(transaction.execute(status -> {
            List<UUID> categories = jdbc.queryForList("""
                    SELECT id
                    FROM community_categories
                    WHERE slug = ? AND is_active = TRUE
                    """, UUID.class, categorySlug);
            if (categories.isEmpty()) {
                throw new CategoryNotFound();
            }
            UUID id = UUID.randomUUID();
            jdbc.update("""
                    INSERT INTO community_posts (
                        id, category_id, author_id, title, body, anonymous, status
                    )
                    VALUES (?, ?, ?, ?, ?, ?, 'visible'::content_status_t)
                    """, id, categories.getFirst(), authorId, title, body, anonymous);
            return loadVisiblePost(id, authorId);
        }));
    }

    Post updatePost(UUID postId, UUID authorId, String title, String body) {
        return required(transaction.execute(status -> {
            OwnedPost owned = ownedPost(postId, true, false);
            if (owned == null) {
                throw new PostNotFound();
            }
            if (!owned.authorId().equals(authorId)) {
                throw new NotAuthor();
            }
            jdbc.update("""
                    UPDATE community_posts
                    SET title = ?, body = ?, updated_at = now()
                    WHERE id = ?
                    """, title, body, postId);
            return loadVisiblePost(postId, authorId);
        }));
    }

    void deletePost(UUID postId, UUID authorId) {
        transaction.executeWithoutResult(status -> {
            OwnedPost owned = ownedPost(postId, false, true);
            if (owned == null) {
                throw new PostNotFound();
            }
            if (!owned.authorId().equals(authorId)) {
                throw new NotAuthor();
            }
            jdbc.update("""
                    UPDATE community_posts
                    SET status = 'deleted'::content_status_t, updated_at = now()
                    WHERE id = ?
                    """, postId);
        });
    }

    void incrementViewCount(UUID postId) {
        jdbc.update("""
                UPDATE community_posts
                SET view_count = view_count + 1
                WHERE id = ?
                """, postId);
    }

    int likePost(UUID postId, UUID userId) {
        return required(transaction.execute(status -> {
            requireVisiblePost(postId);
            namedJdbc.queryForList("""
                    INSERT INTO community_post_likes (id, post_id, user_id)
                    VALUES (:id, :postId, :userId)
                    ON CONFLICT ON CONSTRAINT uq_community_post_likes DO NOTHING
                    RETURNING id
                    """, new MapSqlParameterSource()
                    .addValue("id", UUID.randomUUID())
                    .addValue("postId", postId)
                    .addValue("userId", userId), UUID.class);
            return resyncLikeCount(postId);
        }));
    }

    int unlikePost(UUID postId, UUID userId) {
        return required(transaction.execute(status -> {
            requireVisiblePost(postId);
            jdbc.update("""
                    DELETE FROM community_post_likes
                    WHERE post_id = ? AND user_id = ?
                    """, postId, userId);
            return resyncLikeCount(postId);
        }));
    }

    Page<Comment> listComments(
            UUID postId,
            UUID viewerId,
            String cursor,
            Integer limit) {
        Post post = loadVisiblePost(postId, viewerId);
        int size = clampLimit(limit);
        CommunityVisibilitySpecification.Fragment visibility =
                CommunityVisibilitySpecification.notBlocked("comment", viewerId);
        MapSqlParameterSource parameters = new MapSqlParameterSource()
                .addValues(visibility.parameters())
                .addValue("postId", postId)
                .addValue("fetchLimit", size + 1);
        StringBuilder cursorClause = new StringBuilder();
        if (cursor != null) {
            CommunityCursor.Cursor decoded = CommunityCursor.decode(cursor);
            cursorClause.append("""
                    AND (comment.created_at > :cursorCreatedAt
                         OR (comment.created_at = :cursorCreatedAt AND comment.id > :cursorId))
                    """);
            parameters.addValue("cursorCreatedAt", decoded.createdAt());
            parameters.addValue("cursorId", decoded.id());
        }

        List<Comment> rows = namedJdbc.query("""
                SELECT comment.id,
                       comment.post_id,
                       comment.author_id,
                       comment.anonymous,
                       author.nickname AS author_nickname,
                       comment.body,
                       comment.created_at,
                       comment.updated_at
                FROM community_comments comment
                JOIN users author ON author.id = comment.author_id
                WHERE comment.post_id = :postId
                  AND comment.status = 'visible'::content_status_t
                  AND %s
                  %s
                ORDER BY comment.created_at ASC, comment.id ASC
                LIMIT :fetchLimit
                """.formatted(visibility.sql(), cursorClause), parameters,
                (result, rowNumber) -> comment(result, viewerId));

        boolean hasMore = rows.size() > size;
        List<Comment> items = hasMore
                ? new ArrayList<>(rows.subList(0, size))
                : new ArrayList<>(rows);
        applyAliases(post, items, aliasMap(postId));
        String nextCursor = hasMore && !items.isEmpty()
                ? CommunityCursor.encode(items.getLast().createdAt(), items.getLast().id())
                : null;
        return new Page<>(List.copyOf(items), nextCursor);
    }

    Comment createComment(
            UUID postId,
            UUID authorId,
            String body,
            boolean anonymous) {
        return required(transaction.execute(status -> {
            Post post = loadVisiblePost(postId, null);
            if (anonymous && !(post.anonymous() && post.authorId().equals(authorId))) {
                aliases.ensureAlias(postId, authorId);
            }
            UUID id = UUID.randomUUID();
            jdbc.update("""
                    INSERT INTO community_comments (
                        id, post_id, author_id, body, anonymous, status
                    )
                    VALUES (?, ?, ?, ?, ?, 'visible'::content_status_t)
                    """, id, postId, authorId, body, anonymous);
            jdbc.update("""
                    UPDATE community_posts
                    SET comment_count = comment_count + 1
                    WHERE id = ?
                    """, postId);
            Comment created = loadComment(id, authorId);
            applyAliases(post, List.of(created), aliasMap(postId));
            return created;
        }));
    }

    Comment updateComment(UUID commentId, UUID authorId, String body) {
        return required(transaction.execute(status -> {
            Comment existing = loadComment(commentId, authorId);
            if (existing == null || !existing.visible()) {
                throw new CommentNotFound();
            }
            if (!existing.authorId().equals(authorId)) {
                throw new NotAuthor();
            }
            jdbc.update("""
                    UPDATE community_comments
                    SET body = ?, updated_at = now()
                    WHERE id = ?
                    """, body, commentId);
            Comment updated = loadComment(commentId, authorId);
            Post post = loadPostWithoutVisibility(updated.postId());
            applyAliases(post, List.of(updated), aliasMap(updated.postId()));
            return updated;
        }));
    }

    void deleteComment(UUID commentId, UUID authorId) {
        transaction.executeWithoutResult(status -> {
            List<Comment> rows = jdbc.query("""
                    SELECT comment.id,
                           comment.post_id,
                           comment.author_id,
                           comment.anonymous,
                           author.nickname AS author_nickname,
                           comment.body,
                           comment.created_at,
                           comment.updated_at,
                           comment.status::text AS status
                    FROM community_comments comment
                    JOIN users author ON author.id = comment.author_id
                    WHERE comment.id = ?
                    FOR UPDATE OF comment
                    """, (result, rowNumber) -> commentWithStatus(result, null), commentId);
            if (rows.isEmpty() || rows.getFirst().deleted()) {
                throw new CommentNotFound();
            }
            Comment existing = rows.getFirst();
            if (!existing.authorId().equals(authorId)) {
                throw new NotAuthor();
            }
            jdbc.update("""
                    UPDATE community_comments
                    SET status = 'deleted'::content_status_t, updated_at = now()
                    WHERE id = ?
                    """, commentId);
            jdbc.update("""
                    UPDATE community_posts
                    SET comment_count = GREATEST(comment_count - 1, 0)
                    WHERE id = ?
                    """, existing.postId());
        });
    }

    void createReport(
            UUID reporterId,
            String targetType,
            UUID targetId,
            String reason,
            String detail) {
        transaction.executeWithoutResult(status -> {
            String table = "post".equals(targetType)
                    ? "community_posts"
                    : "community_comments";
            List<UUID> authors = jdbc.queryForList("""
                    SELECT author_id
                    FROM %s
                    WHERE id = ? AND status <> 'deleted'::content_status_t
                    """.formatted(table), UUID.class, targetId);
            if (authors.isEmpty()) {
                throw new PostNotFound();
            }
            if (authors.getFirst().equals(reporterId)) {
                throw new NotAuthor();
            }
            try {
                jdbc.update("""
                        INSERT INTO community_reports (
                            id, reporter_id, target_type, target_id, reason, detail, status
                        )
                        VALUES (?, ?, ?::report_target_type_t, ?, ?::report_reason_t, ?,
                                'pending'::report_status_t)
                        """, UUID.randomUUID(), reporterId, targetType, targetId, reason, detail);
            } catch (DataIntegrityViolationException exception) {
                throw new DuplicateReport(exception);
            }
        });
    }

    List<BlockedUser> listBlocks(UUID blockerId) {
        return jdbc.query("""
                SELECT blocked.id, blocked.nickname
                FROM users blocked
                JOIN community_blocks block ON block.blocked_id = blocked.id
                WHERE block.blocker_id = ?
                ORDER BY block.created_at DESC
                """, (result, rowNumber) -> new BlockedUser(
                result.getObject("id", UUID.class),
                result.getString("nickname")), blockerId);
    }

    void blockUser(UUID blockerId, UUID blockedId) {
        if (blockerId.equals(blockedId)) {
            throw new NotAuthor();
        }
        transaction.executeWithoutResult(status -> {
            if (jdbc.queryForObject(
                    "SELECT COUNT(*) FROM users WHERE id = ?",
                    Integer.class,
                    blockedId) == 0) {
                throw new PostNotFound();
            }
            namedJdbc.queryForList("""
                    INSERT INTO community_blocks (id, blocker_id, blocked_id)
                    VALUES (:id, :blockerId, :blockedId)
                    ON CONFLICT ON CONSTRAINT uq_community_blocks_pair DO NOTHING
                    RETURNING id
                    """, new MapSqlParameterSource()
                    .addValue("id", UUID.randomUUID())
                    .addValue("blockerId", blockerId)
                    .addValue("blockedId", blockedId), UUID.class);
        });
    }

    void unblockUser(UUID blockerId, UUID blockedId) {
        jdbc.update("""
                DELETE FROM community_blocks
                WHERE blocker_id = ? AND blocked_id = ?
                """, blockerId, blockedId);
    }

    private Post loadVisiblePost(UUID postId, UUID viewerId) {
        CommunityVisibilitySpecification.Fragment visibility =
                CommunityVisibilitySpecification.notBlocked("p", viewerId);
        MapSqlParameterSource parameters = new MapSqlParameterSource()
                .addValues(visibility.parameters())
                .addValue("postId", postId);
        String viewerColumn = viewerId == null
                ? "FALSE AS liked_by_me"
                : """
                  EXISTS (
                      SELECT 1 FROM community_post_likes viewer_like
                      WHERE viewer_like.post_id = p.id AND viewer_like.user_id = :viewerId
                  ) AS liked_by_me
                  """;
        List<Post> rows = namedJdbc.query("""
                SELECT p.id,
                       p.author_id,
                       p.anonymous,
                       category.slug AS category_slug,
                       category.name AS category_name,
                       author.nickname AS author_nickname,
                       p.title,
                       p.body,
                       p.like_count,
                       p.comment_count,
                       p.view_count,
                       p.created_at,
                       p.updated_at,
                       %s
                FROM community_posts p
                JOIN community_categories category ON category.id = p.category_id
                JOIN users author ON author.id = p.author_id
                WHERE p.id = :postId
                  AND p.status = 'visible'::content_status_t
                  AND %s
                """.formatted(viewerColumn, visibility.sql()), parameters,
                (result, rowNumber) -> post(result, viewerId));
        if (rows.isEmpty()) {
            throw new PostNotFound();
        }
        return rows.getFirst();
    }

    private Post loadPostWithoutVisibility(UUID postId) {
        List<Post> rows = jdbc.query("""
                SELECT p.id,
                       p.author_id,
                       p.anonymous,
                       category.slug AS category_slug,
                       category.name AS category_name,
                       author.nickname AS author_nickname,
                       p.title,
                       p.body,
                       p.like_count,
                       p.comment_count,
                       p.view_count,
                       p.created_at,
                       p.updated_at,
                       FALSE AS liked_by_me
                FROM community_posts p
                JOIN community_categories category ON category.id = p.category_id
                JOIN users author ON author.id = p.author_id
                WHERE p.id = ?
                """, (result, rowNumber) -> post(result, null), postId);
        if (rows.isEmpty()) {
            throw new PostNotFound();
        }
        return rows.getFirst();
    }

    private OwnedPost ownedPost(UUID postId, boolean visibleOnly, boolean lock) {
        String status = visibleOnly
                ? "AND status = 'visible'::content_status_t"
                : "AND status <> 'deleted'::content_status_t";
        String lockClause = lock ? "FOR UPDATE" : "";
        List<UUID> rows = jdbc.queryForList("""
                SELECT author_id
                FROM community_posts
                WHERE id = ? %s
                %s
                """.formatted(status, lockClause), UUID.class, postId);
        return rows.isEmpty() ? null : new OwnedPost(rows.getFirst());
    }

    private void requireVisiblePost(UUID postId) {
        if (jdbc.queryForObject("""
                SELECT COUNT(*)
                FROM community_posts
                WHERE id = ? AND status = 'visible'::content_status_t
                """, Integer.class, postId) == 0) {
            throw new PostNotFound();
        }
    }

    private int resyncLikeCount(UUID postId) {
        List<Integer> counts = jdbc.queryForList("""
                UPDATE community_posts AS like_count_post
                SET like_count = (
                    SELECT COUNT(*)
                    FROM community_post_likes community_like
                    WHERE community_like.post_id = like_count_post.id
                )
                WHERE like_count_post.id = ?
                RETURNING like_count
                """, Integer.class, postId);
        if (counts.isEmpty()) {
            throw new PostNotFound();
        }
        return counts.getFirst();
    }

    private Comment loadComment(UUID commentId, UUID viewerId) {
        List<Comment> rows = jdbc.query("""
                SELECT comment.id,
                       comment.post_id,
                       comment.author_id,
                       comment.anonymous,
                       author.nickname AS author_nickname,
                       comment.body,
                       comment.created_at,
                       comment.updated_at,
                       comment.status::text AS status
                FROM community_comments comment
                JOIN users author ON author.id = comment.author_id
                WHERE comment.id = ?
                """, (result, rowNumber) -> commentWithStatus(result, viewerId), commentId);
        return rows.isEmpty() ? null : rows.getFirst();
    }

    private Map<UUID, Integer> aliasMap(UUID postId) {
        Map<UUID, Integer> result = new HashMap<>();
        List<Map.Entry<UUID, Integer>> rows = jdbc.query("""
                SELECT user_id, ordinal
                FROM community_anonymous_aliases
                WHERE post_id = ?
                """, (row, rowNumber) -> Map.entry(
                row.getObject("user_id", UUID.class),
                row.getInt("ordinal")), postId);
        rows.forEach(entry -> result.put(entry.getKey(), entry.getValue()));
        return result;
    }

    private static void applyAliases(
            Post post,
            List<Comment> comments,
            Map<UUID, Integer> aliases) {
        for (Comment comment : comments) {
            if (!comment.anonymous()) {
                continue;
            }
            if (post.anonymous() && comment.authorId().equals(post.authorId())) {
                comment.alias("글쓴이");
                continue;
            }
            Integer ordinal = aliases.get(comment.authorId());
            comment.alias(ordinal == null ? "익명" : "익명" + ordinal);
        }
    }

    private static Post post(ResultSet result, UUID viewerId) throws SQLException {
        UUID authorId = result.getObject("author_id", UUID.class);
        return new Post(
                result.getObject("id", UUID.class),
                authorId,
                result.getBoolean("anonymous"),
                result.getString("category_slug"),
                result.getString("category_name"),
                result.getString("author_nickname"),
                result.getString("title"),
                result.getString("body"),
                result.getInt("like_count"),
                result.getInt("comment_count"),
                result.getInt("view_count"),
                result.getBoolean("liked_by_me"),
                viewerId != null && viewerId.equals(authorId),
                result.getObject("created_at", OffsetDateTime.class),
                result.getObject("updated_at", OffsetDateTime.class));
    }

    private static Comment comment(ResultSet result, UUID viewerId) throws SQLException {
        UUID authorId = result.getObject("author_id", UUID.class);
        return new Comment(
                result.getObject("id", UUID.class),
                result.getObject("post_id", UUID.class),
                authorId,
                result.getBoolean("anonymous"),
                result.getString("author_nickname"),
                result.getString("body"),
                viewerId != null && viewerId.equals(authorId),
                result.getObject("created_at", OffsetDateTime.class),
                result.getObject("updated_at", OffsetDateTime.class),
                true);
    }

    private static Comment commentWithStatus(ResultSet result, UUID viewerId) throws SQLException {
        Comment comment = comment(result, viewerId);
        comment.status(result.getString("status"));
        return comment;
    }

    private static int clampLimit(Integer limit) {
        if (limit == null) {
            return DEFAULT_PAGE_SIZE;
        }
        return Math.max(1, Math.min(limit, MAX_PAGE_SIZE));
    }

    private static <T> T required(T value) {
        return Objects.requireNonNull(value, "transaction returned no value");
    }

    record Category(String slug, String name, String description) {
    }

    record Page<T>(List<T> items, String nextCursor) {
    }

    record Post(
            UUID id,
            UUID authorId,
            boolean anonymous,
            String categorySlug,
            String categoryName,
            String authorNickname,
            String title,
            String body,
            int likeCount,
            int commentCount,
            int viewCount,
            boolean likedByMe,
            boolean mine,
            OffsetDateTime createdAt,
            OffsetDateTime updatedAt) {
    }

    static final class Comment {
        private final UUID id;
        private final UUID postId;
        private final UUID authorId;
        private final boolean anonymous;
        private final String authorNickname;
        private final String body;
        private final boolean mine;
        private final OffsetDateTime createdAt;
        private final OffsetDateTime updatedAt;
        private String alias;
        private String status;

        Comment(
                UUID id,
                UUID postId,
                UUID authorId,
                boolean anonymous,
                String authorNickname,
                String body,
                boolean mine,
                OffsetDateTime createdAt,
                OffsetDateTime updatedAt,
                boolean visible) {
            this.id = id;
            this.postId = postId;
            this.authorId = authorId;
            this.anonymous = anonymous;
            this.authorNickname = authorNickname;
            this.body = body;
            this.mine = mine;
            this.createdAt = createdAt;
            this.updatedAt = updatedAt;
            this.status = visible ? "visible" : "deleted";
        }

        UUID id() { return id; }
        UUID postId() { return postId; }
        UUID authorId() { return authorId; }
        boolean anonymous() { return anonymous; }
        String authorNickname() { return authorNickname; }
        String body() { return body; }
        boolean mine() { return mine; }
        OffsetDateTime createdAt() { return createdAt; }
        OffsetDateTime updatedAt() { return updatedAt; }
        String alias() { return alias; }
        boolean visible() { return "visible".equals(status); }
        boolean deleted() { return "deleted".equals(status); }
        void alias(String value) { alias = value; }
        void status(String value) { status = value; }
    }

    record BlockedUser(UUID id, String nickname) {
    }

    private record OwnedPost(UUID authorId) {
    }

    static final class CategoryNotFound extends RuntimeException {
    }

    static final class PostNotFound extends RuntimeException {
    }

    static final class CommentNotFound extends RuntimeException {
    }

    static final class NotAuthor extends RuntimeException {
    }

    static final class DuplicateReport extends RuntimeException {
        DuplicateReport(Throwable cause) {
            super(cause);
        }
    }
}
