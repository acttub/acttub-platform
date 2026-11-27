package com.acttub.actingapi.feature.community.adapter.db;

import static com.acttub.actingapi.platform.persistence.NativeTuples.list;

import java.time.Clock;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;

import com.acttub.actingapi.feature.challenge.app.UserBlocking;
import com.acttub.actingapi.feature.community.app.CommunityContentNotFound;
import com.acttub.actingapi.feature.community.app.CommunityImageCleanup;
import com.acttub.actingapi.feature.community.app.CommunityRepository;
import com.acttub.actingapi.feature.community.app.DuplicateReport;
import com.acttub.actingapi.feature.community.app.InvalidCursor;
import com.acttub.actingapi.feature.community.app.InvalidImage;
import com.acttub.actingapi.feature.community.app.NotAuthor;
import com.acttub.actingapi.feature.community.app.Page;
import com.acttub.actingapi.feature.community.app.ReportingOwnContent;
import com.acttub.actingapi.feature.community.domain.CommunityCategory;
import com.acttub.actingapi.feature.community.domain.CommunityComment;
import com.acttub.actingapi.feature.community.domain.CommunityPost;
import com.acttub.actingapi.feature.community.domain.PostImage;
import com.acttub.actingapi.feature.community.schema.CommunityCommentEntity;
import com.acttub.actingapi.feature.community.schema.CommunityPostEntity;
import com.acttub.actingapi.feature.community.schema.CommunityReportEntity;
import com.acttub.actingapi.feature.community.schema.CommunityPostImageEntity;
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
 * Community 포트를 Spring Data JPA로 구현한다.
 *
 * <p><b>트랜잭션 경계가 이 클래스 안에 있다.</b> 없음·소유권 판정과 그에 따른 쓰기가 한 트랜잭션·
 * 한 잠금 안에서 끝나야 하므로, 서비스가 조회와 쓰기를 따로 부르는 형태로 가르지 않았다.
 * 수를 바꾸는 갱신은 한 문장이고, {@code RETURNING} 이 있던 자리는 같은 트랜잭션에서 다시 읽는다.
 *
 * <p><b>native SQL 은 다른 기능의 표를 쓰는 문장만 남았다</b>(apps/api/CONTRACT.md §5-9, {@code native-sql-files.txt} 의
 * 남김 줄). 글·댓글 조회는 작성자 이름과 탈퇴 여부(auth 의 {@code users}, profile 의 {@code user_profiles})와
 * 차단(challenge 의 {@code user_blocks})을 한 문장에서 조인한다. 차단하기는 상대가 있는지 {@code users} 를 읽고 차단 넣기는
 * challenge 의 {@code UserBlocking} 이 한다.
 */
@Repository
class PostgresCommunityRepository implements CommunityRepository {
    private static final int DEFAULT_PAGE_SIZE = 20;
    private static final int MAX_PAGE_SIZE = 50;
    /** 이만큼의 서로 다른 사람이 처리 전 신고를 내면 대상을 가린다. */
    static final int AUTO_HIDE_REPORTERS = 3;
    /** 남에게는 보이는 글만, 본인에게는 가려진 자기 글까지. {@code :viewerId} 가 늘 있다(회원 전용). */
    private static final String SHOWN_POST =
            "(p.status = 'visible' OR (p.status = 'hidden' AND p.author_id = CAST(:viewerId AS uuid)))";
    private static final String POST_COLUMNS = """
            p.id AS id,
            p.author_id AS author_id,
            p.anonymous AS anonymous,
            category.slug AS category_slug,
            category.name AS category_name,
            CASE WHEN author.status = 'deactivated'
                 THEN '탈퇴한 사용자'
                 ELSE coalesce(author_profile.name, '배우') END AS author_nickname,
            p.title AS title,
            p.body AS body,
            p.like_count AS like_count,
            p.comment_count AS comment_count,
            p.view_count AS view_count,
            p.created_at AS created_at,
            p.updated_at AS updated_at,
            p.status AS status
            """;
    private static final String COMMENT_COLUMNS = """
            comment.id AS id,
            comment.post_id AS post_id,
            comment.author_id AS author_id,
            comment.anonymous AS anonymous,
            CASE WHEN author.status = 'deactivated'
                 THEN '탈퇴한 사용자'
                 ELSE coalesce(author_profile.name, '배우') END AS author_nickname,
            comment.body AS body,
            comment.created_at AS created_at,
            comment.updated_at AS updated_at,
            comment.status AS status
            """;

    private final CommunityCategoryJpaRepository categories;
    private final CommunityPostJpaRepository posts;
    private final CommunityCommentJpaRepository comments;
    private final CommunityAnonymousAliasJpaRepository anonymousAliases;
    private final CommunityPostLikeJpaRepository likes;
    private final CommunityReportJpaRepository reports;
    private final CommunityPostImageJpaRepository images;
    private final EntityManager entityManager;
    private final TransactionTemplate transaction;
    private final AnonymousAliasAllocator aliases;
    private final CommunityImageCleanup imageCleanup;
    private final Clock clock;
    private final UserBlocking blocking;

    PostgresCommunityRepository(
            CommunityCategoryJpaRepository categories,
            CommunityPostJpaRepository posts,
            CommunityCommentJpaRepository comments,
            CommunityAnonymousAliasJpaRepository anonymousAliases,
            CommunityPostLikeJpaRepository likes,
            CommunityReportJpaRepository reports,
            CommunityPostImageJpaRepository images,
            EntityManager entityManager,
            PlatformTransactionManager transactionManager,
            AnonymousAliasAllocator aliases,
            CommunityImageCleanup imageCleanup,
            Clock clock,
            UserBlocking blocking) {
        this.blocking = blocking;
        this.categories = categories;
        this.posts = posts;
        this.comments = comments;
        this.anonymousAliases = anonymousAliases;
        this.likes = likes;
        this.reports = reports;
        this.images = images;
        this.entityManager = entityManager;
        this.transaction = new TransactionTemplate(transactionManager);
        this.aliases = aliases;
        this.imageCleanup = imageCleanup;
        this.clock = clock;
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
        parameters.put("viewerId", viewerId);
        parameters.put("fetchLimit", size + 1);

        StringBuilder where = new StringBuilder("""
                %s
                AND %s
                """.formatted(SHOWN_POST, visibility.sql()).strip());
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
                LEFT JOIN user_profiles author_profile ON author_profile.user_id = p.author_id
                WHERE %s
                ORDER BY p.created_at DESC, p.id DESC
                LIMIT :fetchLimit
                """.formatted(POST_COLUMNS, viewerColumns, where), parameters)).stream()
                .map(row -> post(row, viewerId))
                .toList();

        boolean hasMore = rows.size() > size;
        List<CommunityPost> items = withImages(hasMore ? rows.subList(0, size) : rows);
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
            boolean anonymous,
            List<UUID> imageIds) {
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
            attachImages(id, authorId, imageIds);
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
    public PostWrite updatePost(
            UUID postId, UUID authorId, String title, String body, List<UUID> imageIds) {
        return required(transaction.execute(status -> {
            // 사진을 바꾸면 행을 잠근다 — 같은 글을 고치는 두 요청이 서로의 순서를 덮지 않게.
            UUID owner = (imageIds == null
                    ? posts.authorWithStatus(postId, ContentStatus.VISIBLE)
                    : posts.lockAuthorWithStatus(postId, ContentStatus.VISIBLE))
                    .orElseThrow(CommunityContentNotFound::new);
            if (!owner.equals(authorId)) {
                throw new NotAuthor();
            }
            posts.updateContent(postId, title, body);
            List<UUID> cleanups = imageIds == null ? List.of() : replaceImages(postId, authorId, imageIds);
            return new PostWrite(loadVisiblePost(postId, authorId), cleanups);
        }));
    }

    @Override
    public List<UUID> deletePost(UUID postId, UUID authorId) {
        return required(transaction.execute(status -> {
            UUID owner = posts.lockAuthorWithoutStatus(postId, ContentStatus.DELETED)
                    .orElseThrow(CommunityContentNotFound::new);
            if (!owner.equals(authorId)) {
                throw new NotAuthor();
            }
            posts.updateStatus(postId, ContentStatus.DELETED);
            return detachAll(postId, authorId);
        }));
    }

    /**
     * 새 글에 사진을 붙인다. 모두 이 사람이 올렸고 올라왔고 아직 어느 글에도 붙지 않아야 한다 — 아니면
     * {@link InvalidImage} 이고 글 쓰기 전체가 되돌아간다.
     */
    private void attachImages(UUID postId, UUID authorId, List<UUID> imageIds) {
        if (imageIds.isEmpty()) {
            return;
        }
        lockAttachable(postId, authorId, imageIds);
        order(postId, imageIds);
    }

    /**
     * 글의 사진을 이 목록으로 바꾼다. 빠진 사진은 행을 지우고 객체 삭제를 장부에 올린다.
     *
     * <p>순서를 다시 매기기 전에 남길 행을 잠깐 떼어 둔다 — {@code (post_id, sort_order)} 가 유일해서 자리를 맞바꾸는
     * 순서 변경이 한 행씩 고치는 도중에 부딪힌다.
     *
     * <p>뺄 행은 잠가 읽고 그 id 로 지운다. 앞서 잡은 글 행의 {@code FOR UPDATE} 가 이 글에 새로 붙는 행(FK 의
     * {@code FOR KEY SHARE})을 막아, 읽은 뒤에 조건에 드는 행이 없다.
     */
    private List<UUID> replaceImages(UUID postId, UUID authorId, List<UUID> imageIds) {
        lockAttachable(postId, authorId, imageIds);
        List<String> removedKeys = remove(imageIds.isEmpty()
                ? images.lockAttachedTo(postId)
                : images.lockAttachedToExcept(postId, imageIds));
        images.detachAll(postId);
        order(postId, imageIds);
        if (removedKeys.isEmpty()) {
            return List.of();
        }
        Instant now = clock.instant();
        return List.of(imageCleanup.schedule(authorId, removedKeys, now, now));
    }

    /** 지운 글의 사진 행을 지우고 객체 삭제를 장부에 올린다. 글 행은 남는다(삭제 표시). */
    private List<UUID> detachAll(UUID postId, UUID authorId) {
        List<String> keys = remove(images.lockAttachedTo(postId));
        if (keys.isEmpty()) {
            return List.of();
        }
        Instant now = clock.instant();
        return List.of(imageCleanup.schedule(authorId, keys, now, now));
    }

    /** 잠가 읽은 사진 행을 그 id 로 지우고 객체 키를 돌려준다. */
    private List<String> remove(List<CommunityPostImageEntity> locked) {
        if (locked.isEmpty()) {
            return List.of();
        }
        images.deleteByIds(locked.stream().map(CommunityPostImageEntity::getId).toList());
        return locked.stream().map(CommunityPostImageEntity::getObjectKey).toList();
    }

    /** 붙일 사진 행을 잠그고 붙일 수 있는지 본다. 이 글에 이미 붙은 것은 된다(고치기에서 남기는 사진). */
    private void lockAttachable(UUID postId, UUID authorId, List<UUID> imageIds) {
        if (imageIds.isEmpty()) {
            return;
        }
        long attachable = images.lockByIds(imageIds).stream()
                .filter(row -> authorId.equals(row.getUploaderId()))
                .filter(row -> row.getUploadedAt() != null)
                .filter(row -> row.getPostId() == null || postId.equals(row.getPostId()))
                .count();
        if (attachable != imageIds.size()) {
            throw new InvalidImage();
        }
    }

    private void order(UUID postId, List<UUID> imageIds) {
        for (int index = 0; index < imageIds.size(); index++) {
            images.attach(imageIds.get(index), postId, index);
        }
    }

    /** 글들에 붙은 사진을 한 번에 읽어 순서대로 채운다. */
    private List<CommunityPost> withImages(List<CommunityPost> rows) {
        if (rows.isEmpty()) {
            return List.of();
        }
        Map<UUID, List<PostImage>> byPost = new HashMap<>();
        images.attachedTo(rows.stream().map(CommunityPost::id).toList())
                .forEach(row -> byPost.computeIfAbsent(row.getPostId(), key -> new ArrayList<>())
                        .add(new PostImage(row.getId(), row.getObjectKey())));
        return rows.stream()
                .map(post -> post.withImages(byPost.getOrDefault(post.id(), List.of())))
                .toList();
    }

    @Override
    public void incrementViewCount(UUID postId) {
        transaction.executeWithoutResult(status -> posts.incrementViewCount(postId));
    }

    @Override
    public int likePost(UUID postId, UUID userId) {
        return required(transaction.execute(status -> {
            lockVisiblePost(postId);
            likes.insertOnce(UUID.randomUUID(), postId, userId);
            return resyncLikeCount(postId);
        }));
    }

    @Override
    public int unlikePost(UUID postId, UUID userId) {
        return required(transaction.execute(status -> {
            lockVisiblePost(postId);
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
        parameters.put("viewerId", viewerId);
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
                LEFT JOIN user_profiles author_profile ON author_profile.user_id = comment.author_id
                WHERE comment.post_id = :postId
                  AND (comment.status = 'visible'
                       OR (comment.status = 'hidden' AND comment.author_id = CAST(:viewerId AS uuid)))
                  AND %s
                  %s
                ORDER BY comment.created_at ASC, comment.id ASC
                LIMIT :fetchLimit
                """.formatted(COMMENT_COLUMNS, visibility.sql(), cursorClause), parameters)).stream()
                .map(row -> commentWithStatus(row, viewerId))
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
            CommunityPost parent = loadPost(postId, authorId, false);
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
            posts.incrementCommentCount(postId);
            CommunityComment created = loadComment(id, authorId);
            return created.named(parent, aliasMap(postId).get(created.authorId()));
        }));
    }

    @Override
    public void deleteComment(UUID commentId, UUID authorId) {
        transaction.executeWithoutResult(status -> {
            CommunityCommentJpaRepository.LockedComment existing = comments.lockForDelete(commentId)
                    .filter(row -> row.getStatus() != ContentStatus.DELETED)
                    .orElseThrow(CommunityContentNotFound::new);
            if (!existing.getAuthorId().equals(authorId)) {
                throw new NotAuthor();
            }
            comments.updateStatus(commentId, ContentStatus.DELETED);
            posts.decrementCommentCount(existing.getPostId());
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
            UUID author = (target == ReportTargetType.POST
                    ? posts.authorWithoutStatus(targetId, ContentStatus.DELETED)
                    : comments.authorWithoutStatus(targetId, ContentStatus.DELETED))
                    .orElseThrow(CommunityContentNotFound::new);
            if (author.equals(reporterId)) {
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
            hideWhenReportedEnough(target, targetId);
        });
    }

    /**
     * 서로 다른 {@value #AUTO_HIDE_REPORTERS}명의 처리 전 신고가 모이면 대상을 가린다. 챌린지 자체 신고와 같은 수다
     * (challenge.report). 가린 글·댓글은 작성자 본인에게만 {@code status: hidden} 으로 보이고, 되살리는 것은 운영이
     * 한다. 대상 행을 잠그고 세므로 동시에 들어온 세 번째 신고가 서로를 못 보고 지나가지 않는다.
     */
    private void hideWhenReportedEnough(ReportTargetType target, UUID targetId) {
        if (target == ReportTargetType.POST) {
            posts.lock(targetId);
            posts.hideWhenReported(targetId, AUTO_HIDE_REPORTERS, ContentStatus.HIDDEN, ContentStatus.VISIBLE,
                    target, ReportStatus.PENDING);
        } else {
            comments.lock(targetId);
            comments.hideWhenReported(targetId, AUTO_HIDE_REPORTERS, ContentStatus.HIDDEN, ContentStatus.VISIBLE,
                    target, ReportStatus.PENDING);
        }
    }

    @Override
    public void blockUser(UUID blockerId, UUID blockedId) {
        transaction.executeWithoutResult(status -> {
            if (!userExists(blockedId)) {
                throw new CommunityContentNotFound();
            }
            blocking.block(blockerId, blockedId);
        });
    }

    @Override
    public boolean legacyBlockedEitherWay(UUID first, UUID second) {
        return !entityManager.createQuery("""
                        select b.id from CommunityBlockEntity b
                        where (b.blockerId = :first and b.blockedId = :second)
                           or (b.blockerId = :second and b.blockedId = :first)
                        """, UUID.class)
                .setParameter("first", first)
                .setParameter("second", second)
                .setMaxResults(1)
                .getResultList()
                .isEmpty();
    }

    @Override
    public void createConversationReport(UUID reporterId, UUID conversationId, String reason, String detail) {
        transaction.executeWithoutResult(status -> {
            try {
                reports.saveAndFlush(new CommunityReportEntity(
                        UUID.randomUUID(),
                        reporterId,
                        ReportTargetType.CONVERSATION,
                        conversationId,
                        enumValue(ReportReason.class, reason),
                        detail,
                        ReportStatus.PENDING));
            } catch (DataIntegrityViolationException exception) {
                throw new DuplicateReport(exception);
            }
        });
    }

    private CommunityPost loadVisiblePost(UUID postId, UUID viewerId) {
        return loadPost(postId, viewerId, true);
    }

    /**
     * 보는 사람에게 보이는 글 하나. {@code ownHidden} 이면 본인의 가려진 글도 돌려준다(읽기). 쓰기의 대상을
     * 고를 때는 거짓으로 불러 가려진 글에 댓글이 달리지 않게 한다.
     */
    private CommunityPost loadPost(UUID postId, UUID viewerId, boolean ownHidden) {
        CommunityVisibilitySpecification.Fragment visibility =
                CommunityVisibilitySpecification.notBlocked("p", viewerId);
        Map<String, Object> parameters = new HashMap<>(visibility.parameters());
        parameters.put("postId", postId);
        parameters.put("viewerId", viewerId);
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
                LEFT JOIN user_profiles author_profile ON author_profile.user_id = p.author_id
                WHERE p.id = :postId
                  AND %s
                  AND %s
                """.formatted(POST_COLUMNS, viewerColumn, ownHidden ? SHOWN_POST : "p.status = 'visible'",
                        visibility.sql()), parameters)).stream()
                .map(row -> post(row, viewerId))
                .toList();
        if (rows.isEmpty()) {
            throw new CommunityContentNotFound();
        }
        return withImages(rows).getFirst();
    }

    private void lockVisiblePost(UUID postId) {
        // 다시 세기 전에 쓰기를 줄 세운다. 기다린 요청은 앞의 커밋을 본다.
        if (posts.lockAuthorWithStatus(postId, ContentStatus.VISIBLE).isEmpty()) {
            throw new CommunityContentNotFound();
        }
    }

    /** 다시 세어 저장하고, 같은 트랜잭션에서 그 값을 읽는다. 고친 행은 이 트랜잭션이 잡고 있다. */
    private int resyncLikeCount(UUID postId) {
        if (posts.recountLikes(postId) == 0) {
            throw new CommunityContentNotFound();
        }
        return posts.likeCount(postId).orElseThrow(CommunityContentNotFound::new);
    }

    private CommunityComment loadComment(UUID commentId, UUID viewerId) {
        List<CommunityComment> rows = list(entityManager.createNativeQuery("""
                SELECT %s
                FROM community_comments comment
                JOIN users author ON author.id = comment.author_id
                LEFT JOIN user_profiles author_profile ON author_profile.user_id = comment.author_id
                WHERE comment.id = :commentId
                """.formatted(COMMENT_COLUMNS), Tuple.class)
                .setParameter("commentId", commentId)).stream()
                .map(row -> commentWithStatus(row, viewerId))
                .toList();
        return rows.isEmpty() ? null : rows.getFirst();
    }

    private Map<UUID, Integer> aliasMap(UUID postId) {
        Map<UUID, Integer> result = new HashMap<>();
        anonymousAliases.findAliasesByPostId(postId).forEach(row -> result.put(
                row.getUserId(), row.getOrdinal()));
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
                utc(row, "updated_at"),
                row.get("status", String.class),
                List.of());
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
}
