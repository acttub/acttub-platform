package com.acttub.actingapi.feature.community.adapter.db;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.OffsetDateTime;
import java.util.HashMap;
import java.util.List;
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
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 손으로 쓴 SQL 로 포트를 구현한다. JPA 로 가지 않는 이유는 SPEC §5-5 에 있다 — Schema Entity 는
 * {@code ddl-auto: validate} 의 대조 대상일 뿐 호출되지 않는다.
 *
 * <p><b>트랜잭션 경계가 이 클래스 안에 있다.</b> 없음·소유권 판정과 그에 따른 쓰기가 한 트랜잭션·
 * 한 잠금 안에서 끝나야 하므로, 서비스가 조회와 쓰기를 따로 부르는 형태로 가르지 않았다.
 */
@Repository
class PostgresCommunityRepository implements CommunityRepository {
    private static final int DEFAULT_PAGE_SIZE = 20;
    private static final int MAX_PAGE_SIZE = 50;

    private final JdbcTemplate jdbc;
    private final NamedParameterJdbcTemplate namedJdbc;
    private final TransactionTemplate transaction;
    private final AnonymousAliasAllocator aliases;

    PostgresCommunityRepository(
            JdbcTemplate jdbc,
            TransactionTemplate transaction,
            AnonymousAliasAllocator aliases) {
        this.jdbc = jdbc;
        this.namedJdbc = new NamedParameterJdbcTemplate(jdbc);
        this.transaction = transaction;
        this.aliases = aliases;
    }

    @Override
    public List<CommunityCategory> listCategories() {
        return jdbc.query("""
                SELECT slug, name, description
                FROM community_categories
                WHERE is_active = TRUE
                ORDER BY sort_order, slug
                """, (result, rowNumber) -> new CommunityCategory(
                result.getString("slug"),
                result.getString("name"),
                result.getString("description")));
    }

    @Override
    public Page<CommunityPost> listPosts(
            UUID viewerId, String categorySlug, String cursor, Integer limit) {
        int size = clampLimit(limit);
        CommunityVisibilitySpecification.Fragment visibility =
                CommunityVisibilitySpecification.notBlocked("p", viewerId);
        MapSqlParameterSource parameters = new MapSqlParameterSource()
                .addValues(visibility.parameters())
                .addValue("fetchLimit", size + 1);

        StringBuilder where = new StringBuilder("""
                p.status = 'visible'
                AND %s
                """.formatted(visibility.sql()).strip());
        if (categorySlug != null) {
            where.append("\nAND category.slug = :categorySlug");
            parameters.addValue("categorySlug", categorySlug);
        }
        if (cursor != null) {
            CommunityCursor.Cursor decoded = decodeCursor(cursor);
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
        List<CommunityPost> rows = namedJdbc.query("""
                SELECT p.id,
                       p.author_id,
                       p.anonymous,
                       category.slug AS category_slug,
                       category.name AS category_name,
                       CASE WHEN author.status = 'deactivated'
                            THEN '탈퇴한 사용자'
                            ELSE author.nickname END AS author_nickname,
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
            List<UUID> categories = jdbc.queryForList("""
                    SELECT id
                    FROM community_categories
                    WHERE slug = ? AND is_active = TRUE
                    """, UUID.class, categorySlug);
            if (categories.isEmpty()) {
                throw new CommunityContentNotFound();
            }
            UUID id = UUID.randomUUID();
            jdbc.update("""
                    INSERT INTO community_posts (
                        id, category_id, author_id, title, body, anonymous, status
                    )
                    VALUES (?, ?, ?, ?, ?, ?, 'visible')
                    """, id, categories.getFirst(), authorId, title, body, anonymous);
            return justInserted(id, authorId);
        }));
    }

    /**
     * 방금 넣은 글을 응답에 실을 형태로 다시 읽는다.
     *
     * <p>🔥 <b>없으면 {@link CommunityContentNotFound} 가 아니다.</b> 이 자리의 "없음" 은 분류가
     * 없다는 뜻이 아니라 방금 넣은 행이 조회 조건에 안 걸린다는 뜻이고(작성자가 자기 자신을
     * 차단한 행이 남아 있으면 그렇게 된다), 서비스가 그것을 {@code category_not_found} 로 옮기면
     * 멀쩡한 분류를 탓하게 된다. 종전에도 이 자리는 컨트롤러 catch 를 비껴 500 이었다 —
     * 예외를 하나로 합치면서 조용히 404 가 될 뻔했다.
     *
     * <p>⚠ {@code updatePost} 의 같은 모양은 감싸지 않는다. 그쪽은 종전에도 컨트롤러가
     * {@code PostNotFound} 를 잡아 404 {@code post_not_found} 였으므로 지금과 같다.
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
            jdbc.update("""
                    UPDATE community_posts
                    SET title = ?, body = ?, updated_at = now()
                    WHERE id = ?
                    """, title, body, postId);
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
            jdbc.update("""
                    UPDATE community_posts
                    SET status = 'deleted', updated_at = now()
                    WHERE id = ?
                    """, postId);
        });
    }

    @Override
    public void incrementViewCount(UUID postId) {
        jdbc.update("""
                UPDATE community_posts
                SET view_count = view_count + 1
                WHERE id = ?
                """, postId);
    }

    @Override
    public int likePost(UUID postId, UUID userId) {
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

    @Override
    public int unlikePost(UUID postId, UUID userId) {
        return required(transaction.execute(status -> {
            requireVisiblePost(postId);
            jdbc.update("""
                    DELETE FROM community_post_likes
                    WHERE post_id = ? AND user_id = ?
                    """, postId, userId);
            return resyncLikeCount(postId);
        }));
    }

    @Override
    public Page<CommunityComment> listComments(
            UUID postId,
            UUID viewerId,
            String cursor,
            Integer limit) {
        // 커서 해독이 글 조회 **뒤에** 일어난다 —
        // `db/community_store.py:CommunityStore.list_comments` 가 `_load_post_row` 를 먼저 부르고
        // 호출부가 PostNotFound 를 ValueError 보다 먼저 잡는다. 여기서 미리 해독하면
        // "없는 글 + 잘못된 커서" 가 404 대신 400 이 된다.
        CommunityPost post = loadVisiblePost(postId, viewerId);
        int size = clampLimit(limit);
        CommunityVisibilitySpecification.Fragment visibility =
                CommunityVisibilitySpecification.notBlocked("comment", viewerId);
        MapSqlParameterSource parameters = new MapSqlParameterSource()
                .addValues(visibility.parameters())
                .addValue("postId", postId)
                .addValue("fetchLimit", size + 1);
        StringBuilder cursorClause = new StringBuilder();
        if (cursor != null) {
            CommunityCursor.Cursor decoded = decodeCursor(cursor);
            cursorClause.append("""
                    AND (comment.created_at > :cursorCreatedAt
                         OR (comment.created_at = :cursorCreatedAt AND comment.id > :cursorId))
                    """);
            parameters.addValue("cursorCreatedAt", decoded.createdAt());
            parameters.addValue("cursorId", decoded.id());
        }

        List<CommunityComment> rows = namedJdbc.query("""
                SELECT comment.id,
                       comment.post_id,
                       comment.author_id,
                       comment.anonymous,
                       CASE WHEN author.status = 'deactivated'
                            THEN '탈퇴한 사용자'
                            ELSE author.nickname END AS author_nickname,
                       comment.body,
                       comment.created_at,
                       comment.updated_at
                FROM community_comments comment
                JOIN users author ON author.id = comment.author_id
                WHERE comment.post_id = :postId
                  AND comment.status = 'visible'
                  AND %s
                  %s
                ORDER BY comment.created_at ASC, comment.id ASC
                LIMIT :fetchLimit
                """.formatted(visibility.sql(), cursorClause), parameters,
                (result, rowNumber) -> comment(result, viewerId));

        boolean hasMore = rows.size() > size;
        List<CommunityComment> page = hasMore ? rows.subList(0, size) : rows;
        List<CommunityComment> items = named(post, page, aliasMap(postId));
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
            CommunityPost post = loadVisiblePost(postId, null);
            if (anonymous && !post.writtenAnonymouslyBy(authorId)) {
                aliases.ensureAlias(postId, authorId);
            }
            UUID id = UUID.randomUUID();
            jdbc.update("""
                    INSERT INTO community_comments (
                        id, post_id, author_id, body, anonymous, status
                    )
                    VALUES (?, ?, ?, ?, ?, 'visible')
                    """, id, postId, authorId, body, anonymous);
            jdbc.update("""
                    UPDATE community_posts
                    SET comment_count = comment_count + 1
                    WHERE id = ?
                    """, postId);
            CommunityComment created = loadComment(id, authorId);
            return created.named(post, aliasMap(postId).get(created.authorId()));
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
            jdbc.update("""
                    UPDATE community_comments
                    SET body = ?, updated_at = now()
                    WHERE id = ?
                    """, body, commentId);
            CommunityComment updated = loadComment(commentId, authorId);
            CommunityPost post = parentPostOf(updated);
            return updated.named(post, aliasMap(updated.postId()).get(updated.authorId()));
        }));
    }

    @Override
    public void deleteComment(UUID commentId, UUID authorId) {
        transaction.executeWithoutResult(status -> {
            List<CommunityComment> rows = jdbc.query("""
                    SELECT comment.id,
                           comment.post_id,
                           comment.author_id,
                           comment.anonymous,
                           CASE WHEN author.status = 'deactivated'
                            THEN '탈퇴한 사용자'
                            ELSE author.nickname END AS author_nickname,
                           comment.body,
                           comment.created_at,
                           comment.updated_at,
                           comment.status
                    FROM community_comments comment
                    JOIN users author ON author.id = comment.author_id
                    WHERE comment.id = ?
                    FOR UPDATE OF comment
                    """, (result, rowNumber) -> commentWithStatus(result, null), commentId);
            if (rows.isEmpty() || rows.getFirst().isDeleted()) {
                throw new CommunityContentNotFound();
            }
            CommunityComment existing = rows.getFirst();
            if (!existing.authorId().equals(authorId)) {
                throw new NotAuthor();
            }
            jdbc.update("""
                    UPDATE community_comments
                    SET status = 'deleted', updated_at = now()
                    WHERE id = ?
                    """, commentId);
            jdbc.update("""
                    UPDATE community_posts
                    SET comment_count = GREATEST(comment_count - 1, 0)
                    WHERE id = ?
                    """, existing.postId());
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
            String table = "post".equals(targetType)
                    ? "community_posts"
                    : "community_comments";
            List<UUID> authors = jdbc.queryForList("""
                    SELECT author_id
                    FROM %s
                    WHERE id = ? AND status <> 'deleted'
                    """.formatted(table), UUID.class, targetId);
            if (authors.isEmpty()) {
                throw new CommunityContentNotFound();
            }
            if (authors.getFirst().equals(reporterId)) {
                throw new ReportingOwnContent();
            }
            try {
                jdbc.update("""
                        INSERT INTO community_reports (
                            id, reporter_id, target_type, target_id, reason, detail, status
                        )
                        VALUES (?, ?, ?, ?, ?, ?,
                                'pending')
                        """, UUID.randomUUID(), reporterId, targetType, targetId, reason, detail);
            } catch (DataIntegrityViolationException exception) {
                throw new DuplicateReport(exception);
            }
        });
    }

    @Override
    public List<BlockedUser> listBlocks(UUID blockerId) {
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

    @Override
    public void blockUser(UUID blockerId, UUID blockedId) {
        transaction.executeWithoutResult(status -> {
            if (jdbc.queryForObject(
                    "SELECT COUNT(*) FROM users WHERE id = ?",
                    Integer.class,
                    blockedId) == 0) {
                throw new CommunityContentNotFound();
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

    @Override
    public void unblockUser(UUID blockerId, UUID blockedId) {
        jdbc.update("""
                DELETE FROM community_blocks
                WHERE blocker_id = ? AND blocked_id = ?
                """, blockerId, blockedId);
    }

    private CommunityPost loadVisiblePost(UUID postId, UUID viewerId) {
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
        List<CommunityPost> rows = namedJdbc.query("""
                SELECT p.id,
                       p.author_id,
                       p.anonymous,
                       category.slug AS category_slug,
                       category.name AS category_name,
                       CASE WHEN author.status = 'deactivated'
                            THEN '탈퇴한 사용자'
                            ELSE author.nickname END AS author_nickname,
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
                  AND p.status = 'visible'
                  AND %s
                """.formatted(viewerColumn, visibility.sql()), parameters,
                (result, rowNumber) -> post(result, viewerId));
        if (rows.isEmpty()) {
            throw new CommunityContentNotFound();
        }
        return rows.getFirst();
    }

    /**
     * 댓글이 달린 글. 표시 이름을 정하려면 글쓴이가 누구인지 알아야 하므로, 지워졌든 차단됐든
     * 가리지 않고 읽는다.
     *
     * <p>🔥 <b>없으면 {@link CommunityContentNotFound} 가 아니다.</b> 댓글이 있는데 부모 글이
     * 없는 것은 "대상을 못 찾았다" 가 아니라 외래키 불변식이 깨진 것이고, 서비스가 그것을 404 로
     * 옮기면 깨진 데이터가 정상 응답으로 덮인다. 종전에도 이 자리는 컨트롤러 catch 를 비껴
     * 500 이었다 — 예외를 하나로 합치면서 조용히 404 가 될 뻔했다. 같은 패키지의
     * {@code AnonymousAliasAllocator.lockPost} 도 같은 상황에 같은 예외를 던진다.
     */
    private CommunityPost parentPostOf(CommunityComment comment) {
        UUID postId = comment.postId();
        List<CommunityPost> rows = jdbc.query("""
                SELECT p.id,
                       p.author_id,
                       p.anonymous,
                       category.slug AS category_slug,
                       category.name AS category_name,
                       CASE WHEN author.status = 'deactivated'
                            THEN '탈퇴한 사용자'
                            ELSE author.nickname END AS author_nickname,
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
            throw new IllegalStateException("community post is missing");
        }
        return rows.getFirst();
    }

    private OwnedPost ownedPost(UUID postId, boolean visibleOnly, boolean lock) {
        String status = visibleOnly
                ? "AND status = 'visible'"
                : "AND status <> 'deleted'";
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
                WHERE id = ? AND status = 'visible'
                """, Integer.class, postId) == 0) {
            throw new CommunityContentNotFound();
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
            throw new CommunityContentNotFound();
        }
        return counts.getFirst();
    }

    private CommunityComment loadComment(UUID commentId, UUID viewerId) {
        List<CommunityComment> rows = jdbc.query("""
                SELECT comment.id,
                       comment.post_id,
                       comment.author_id,
                       comment.anonymous,
                       CASE WHEN author.status = 'deactivated'
                            THEN '탈퇴한 사용자'
                            ELSE author.nickname END AS author_nickname,
                       comment.body,
                       comment.created_at,
                       comment.updated_at,
                       comment.status
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

    /** 익명 댓글에 표시 이름을 붙인다. 무엇으로 붙일지는 {@code domain} 이 안다. */
    private static List<CommunityComment> named(
            CommunityPost post,
            List<CommunityComment> comments,
            Map<UUID, Integer> aliases) {
        return comments.stream()
                .map(comment -> comment.named(post, aliases.get(comment.authorId())))
                .toList();
    }

    private static CommunityPost post(ResultSet result, UUID viewerId) throws SQLException {
        UUID authorId = result.getObject("author_id", UUID.class);
        return new CommunityPost(
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

    private static CommunityComment comment(ResultSet result, UUID viewerId) throws SQLException {
        UUID authorId = result.getObject("author_id", UUID.class);
        return CommunityComment.visible(
                result.getObject("id", UUID.class),
                result.getObject("post_id", UUID.class),
                authorId,
                result.getBoolean("anonymous"),
                result.getString("author_nickname"),
                result.getString("body"),
                viewerId != null && viewerId.equals(authorId),
                result.getObject("created_at", OffsetDateTime.class),
                result.getObject("updated_at", OffsetDateTime.class));
    }

    private static CommunityComment commentWithStatus(ResultSet result, UUID viewerId)
            throws SQLException {
        return comment(result, viewerId).withStatus(result.getString("status"));
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

    private static <T> T required(T value) {
        return Objects.requireNonNull(value, "transaction returned no value");
    }

    private record OwnedPost(UUID authorId) {
    }
}
