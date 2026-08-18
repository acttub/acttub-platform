package com.acttub.actingapi.feature.community.adapter.db;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import com.acttub.actingapi.support.PostgresContainerSupport;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.dao.InvalidDataAccessApiUsageException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

@SpringBootTest(properties = "JWT_SECRET=test-secret")
class AnonymousAliasAllocatorIT {

    @DynamicPropertySource
    static void datasource(DynamicPropertyRegistry registry) {
        String database = PostgresContainerSupport.createDatabaseName(
                "anonymous_alias_allocator_it");
        registry.add(
                "spring.datasource.url",
                () -> PostgresContainerSupport.jdbcUrlFor(database));
        registry.add(
                "spring.datasource.username",
                PostgresContainerSupport.POSTGRES::getUsername);
        registry.add(
                "spring.datasource.password",
                PostgresContainerSupport.POSTGRES::getPassword);
    }

    @Autowired
    AnonymousAliasAllocator allocator;

    @Autowired
    JdbcTemplate jdbc;

    @Autowired
    PlatformTransactionManager transactionManager;

    @Test
    void concurrentCommentsFromSameUserKeepOneAliasAndBothComments() throws Exception {
        UUID postId = insertPost(insertUser());
        UUID userId = insertUser();

        List<CommentResult> results = createConcurrently(
                postId,
                List.of(userId, userId));

        assertThat(results).extracting(CommentResult::ordinal).containsOnly(1);
        assertThat(results).extracting(CommentResult::backendPid).doesNotHaveDuplicates();
        assertThat(aliasRows(postId)).containsExactly(new AliasRow(userId, 1));
        assertThat(commentIds(postId))
                .containsExactlyInAnyOrderElementsOf(
                        results.stream().map(CommentResult::commentId).toList());
        assertThat(commentCount(postId)).isEqualTo(2);
    }

    @Test
    void concurrentCommentsFromDifferentUsersGetDistinctGaplessAliasesAndBothComments()
            throws Exception {
        UUID postId = insertPost(insertUser());
        UUID firstUserId = insertUser();
        UUID secondUserId = insertUser();

        List<CommentResult> results = createConcurrently(
                postId,
                List.of(firstUserId, secondUserId));

        assertThat(results).extracting(CommentResult::ordinal)
                .containsExactlyInAnyOrder(1, 2);
        assertThat(results).extracting(CommentResult::backendPid).doesNotHaveDuplicates();
        assertThat(aliasRows(postId)).extracting(AliasRow::ordinal)
                .containsExactly(1, 2);
        assertThat(aliasRows(postId)).extracting(AliasRow::userId)
                .containsExactlyInAnyOrder(firstUserId, secondUserId);
        assertThat(commentIds(postId))
                .containsExactlyInAnyOrderElementsOf(
                        results.stream().map(CommentResult::commentId).toList());
        assertThat(commentCount(postId)).isEqualTo(2);
    }

    @Test
    void numberingIsScopedToOnePostAndStartsAtOneWithoutGaps() {
        UUID authorId = insertUser();
        UUID firstPostId = insertPost(authorId);
        UUID secondPostId = insertPost(authorId);
        UUID firstUserId = insertUser();
        UUID secondUserId = insertUser();

        CommentResult first = createComment(firstPostId, firstUserId, UUID.randomUUID());
        CommentResult second = createComment(firstPostId, secondUserId, UUID.randomUUID());
        CommentResult otherPost = createComment(
                secondPostId, secondUserId, UUID.randomUUID());

        assertThat(List.of(first.ordinal(), second.ordinal())).containsExactly(1, 2);
        assertThat(otherPost.ordinal()).isEqualTo(1);
    }

    @Test
    void rollingBackCommentTransactionAlsoRollsBackAlias() {
        UUID postId = insertPost(insertUser());
        UUID userId = insertUser();
        UUID commentId = UUID.randomUUID();

        assertThatThrownBy(() -> requiredTransaction().executeWithoutResult(status -> {
            int ordinal = allocator.ensureAlias(postId, userId);
            assertThat(ordinal).isEqualTo(1);
            insertComment(postId, userId, commentId);
            incrementCommentCount(postId);
            throw new IntentionalRollback();
        })).isInstanceOf(IntentionalRollback.class);

        assertThat(aliasRows(postId)).isEmpty();
        assertThat(commentIds(postId)).doesNotContain(commentId);
        assertThat(commentCount(postId)).isZero();
    }

    @Test
    void allocationRacingPostUpdateCompletesWithoutDeadlock() throws Exception {
        UUID postId = insertPost(insertUser());
        UUID commenterId = insertUser();
        UUID commentId = UUID.randomUUID();
        CountDownLatch aliasLocked = new CountDownLatch(1);
        CountDownLatch commitAlias = new CountDownLatch(1);

        ExecutorService executor = Executors.newFixedThreadPool(2);
        try {
            Future<CommentResult> comment = executor.submit(() ->
                    createCommentWhileHoldingPostLock(
                            postId,
                            commenterId,
                            commentId,
                            aliasLocked,
                            commitAlias));
            assertThat(aliasLocked.await(5, TimeUnit.SECONDS)).isTrue();

            Future<Integer> update = executor.submit(() ->
                    requiredTransaction().execute(status -> jdbc.update("""
                            /* alias-post-update-race */
                            UPDATE community_posts
                            SET title = 'updated while alias was allocated'
                            WHERE id = ?
                            """, postId)));

            awaitBlockedQuery("alias-post-update-race");
            commitAlias.countDown();

            assertThat(comment.get(5, TimeUnit.SECONDS).ordinal()).isEqualTo(1);
            assertThat(update.get(5, TimeUnit.SECONDS)).isEqualTo(1);
            assertThat(postTitle(postId)).isEqualTo("updated while alias was allocated");
            assertThat(commentIds(postId)).contains(commentId);
        } finally {
            commitAlias.countDown();
            executor.shutdownNow();
            executor.awaitTermination(5, TimeUnit.SECONDS);
        }
    }

    @Test
    void allocationRacingPostDeleteCompletesWithoutDeadlock() throws Exception {
        UUID postId = insertPost(insertUser());
        UUID commenterId = insertUser();
        UUID commentId = UUID.randomUUID();
        CountDownLatch aliasLocked = new CountDownLatch(1);
        CountDownLatch commitAlias = new CountDownLatch(1);

        ExecutorService executor = Executors.newFixedThreadPool(2);
        try {
            Future<CommentResult> comment = executor.submit(() ->
                    createCommentWhileHoldingPostLock(
                            postId,
                            commenterId,
                            commentId,
                            aliasLocked,
                            commitAlias));
            assertThat(aliasLocked.await(5, TimeUnit.SECONDS)).isTrue();

            Future<Integer> delete = executor.submit(() ->
                    requiredTransaction().execute(status -> jdbc.update("""
                            /* alias-post-delete-race */
                            UPDATE community_posts
                            SET status = 'deleted'::content_status_t,
                                updated_at = now()
                            WHERE id = ?
                            """, postId)));

            awaitBlockedQuery("alias-post-delete-race");
            commitAlias.countDown();

            assertThat(comment.get(5, TimeUnit.SECONDS).ordinal()).isEqualTo(1);
            assertThat(delete.get(5, TimeUnit.SECONDS)).isEqualTo(1);
            assertThat(postStatus(postId)).isEqualTo("deleted");
            assertThat(commentIds(postId)).contains(commentId);
        } finally {
            commitAlias.countDown();
            executor.shutdownNow();
            executor.awaitTermination(5, TimeUnit.SECONDS);
        }
    }

    @Test
    void allocationRequiresTheCallersTransaction() {
        UUID postId = insertPost(insertUser());
        UUID userId = insertUser();

        // @Repository 의 예외 변환이 IllegalStateException 을 DataAccessException 으로 감싼다.
        assertThatThrownBy(() -> allocator.ensureAlias(postId, userId))
                .isInstanceOf(InvalidDataAccessApiUsageException.class)
                .hasMessageContaining("anonymous alias allocation requires an active transaction");
    }

    private List<CommentResult> createConcurrently(UUID postId, List<UUID> userIds)
            throws Exception {
        CountDownLatch connectionsReady = new CountDownLatch(userIds.size());
        CountDownLatch start = new CountDownLatch(1);
        ExecutorService executor = Executors.newFixedThreadPool(userIds.size());
        try {
            List<Future<CommentResult>> futures = userIds.stream()
                    .map(userId -> executor.submit(() -> requiredTransaction().execute(status -> {
                        int backendPid = jdbc.queryForObject(
                                "SELECT pg_backend_pid()", Integer.class);
                        connectionsReady.countDown();
                        await(start);
                        UUID commentId = UUID.randomUUID();
                        int ordinal = allocator.ensureAlias(postId, userId);
                        insertComment(postId, userId, commentId);
                        incrementCommentCount(postId);
                        return new CommentResult(ordinal, commentId, backendPid);
                    })))
                    .toList();

            assertThat(connectionsReady.await(5, TimeUnit.SECONDS)).isTrue();
            start.countDown();

            return futures.stream().map(this::get).toList();
        } finally {
            start.countDown();
            executor.shutdownNow();
            executor.awaitTermination(5, TimeUnit.SECONDS);
        }
    }

    private CommentResult createComment(UUID postId, UUID userId, UUID commentId) {
        return requiredTransaction().execute(status -> {
            int backendPid = jdbc.queryForObject("SELECT pg_backend_pid()", Integer.class);
            int ordinal = allocator.ensureAlias(postId, userId);
            insertComment(postId, userId, commentId);
            incrementCommentCount(postId);
            return new CommentResult(ordinal, commentId, backendPid);
        });
    }

    private CommentResult createCommentWhileHoldingPostLock(
            UUID postId,
            UUID userId,
            UUID commentId,
            CountDownLatch aliasLocked,
            CountDownLatch commitAlias) {
        return requiredTransaction().execute(status -> {
            int backendPid = jdbc.queryForObject("SELECT pg_backend_pid()", Integer.class);
            int ordinal = allocator.ensureAlias(postId, userId);
            aliasLocked.countDown();
            await(commitAlias);
            insertComment(postId, userId, commentId);
            incrementCommentCount(postId);
            return new CommentResult(ordinal, commentId, backendPid);
        });
    }

    private void insertComment(UUID postId, UUID userId, UUID commentId) {
        jdbc.update("""
                INSERT INTO community_comments (
                    id,
                    post_id,
                    author_id,
                    body,
                    anonymous,
                    status
                )
                VALUES (?, ?, ?, 'anonymous comment', true, 'visible'::content_status_t)
                """, commentId, postId, userId);
    }

    private void incrementCommentCount(UUID postId) {
        jdbc.update("""
                UPDATE community_posts
                SET comment_count = comment_count + 1
                WHERE id = ?
                """, postId);
    }

    private UUID insertUser() {
        UUID userId = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO users (id, email, status)
                VALUES (?, ?, 'active'::user_status_t)
                """, userId, userId + "@example.test");
        return userId;
    }

    private UUID insertPost(UUID authorId) {
        UUID categoryId = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO community_categories (id, slug, name, sort_order, is_active)
                VALUES (?, ?, 'Alias test', 0, true)
                """, categoryId, "alias-test-" + categoryId);

        UUID postId = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO community_posts (
                    id,
                    category_id,
                    author_id,
                    title,
                    body,
                    anonymous,
                    status
                )
                VALUES (?, ?, ?, 'title', 'body', false, 'visible'::content_status_t)
                """, postId, categoryId, authorId);
        return postId;
    }

    private List<AliasRow> aliasRows(UUID postId) {
        return jdbc.query("""
                SELECT user_id, ordinal
                FROM community_anonymous_aliases
                WHERE post_id = ?
                ORDER BY ordinal
                """,
                (row, rowNumber) -> new AliasRow(
                        row.getObject("user_id", UUID.class),
                        row.getInt("ordinal")),
                postId);
    }

    private List<UUID> commentIds(UUID postId) {
        return jdbc.queryForList("""
                SELECT id
                FROM community_comments
                WHERE post_id = ?
                ORDER BY id
                """, UUID.class, postId);
    }

    private int commentCount(UUID postId) {
        return jdbc.queryForObject("""
                SELECT comment_count
                FROM community_posts
                WHERE id = ?
                """, Integer.class, postId);
    }

    private String postTitle(UUID postId) {
        return jdbc.queryForObject(
                "SELECT title FROM community_posts WHERE id = ?",
                String.class,
                postId);
    }

    private String postStatus(UUID postId) {
        return jdbc.queryForObject(
                "SELECT status::text FROM community_posts WHERE id = ?",
                String.class,
                postId);
    }

    private TransactionTemplate requiredTransaction() {
        return new TransactionTemplate(transactionManager);
    }

    private void awaitBlockedQuery(String marker) {
        Instant deadline = Instant.now().plus(Duration.ofSeconds(5));
        while (Instant.now().isBefore(deadline)) {
            Integer count = jdbc.queryForObject("""
                    SELECT count(*)
                    FROM pg_stat_activity
                    WHERE datname = current_database()
                      AND wait_event_type = 'Lock'
                      AND query LIKE ?
                    """, Integer.class, "%" + marker + "%");
            if (count != null && count > 0) {
                return;
            }
            try {
                Thread.sleep(10);
            } catch (InterruptedException exception) {
                Thread.currentThread().interrupt();
                throw new IllegalStateException("lock observation was interrupted", exception);
            }
        }
        throw new AssertionError("query did not wait for the parent post lock: " + marker);
    }

    private void await(CountDownLatch latch) {
        try {
            if (!latch.await(5, TimeUnit.SECONDS)) {
                throw new IllegalStateException("alias concurrency latch timed out");
            }
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("alias concurrency test was interrupted", exception);
        }
    }

    private CommentResult get(Future<CommentResult> future) {
        try {
            return future.get(10, TimeUnit.SECONDS);
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            throw new AssertionError("concurrent comment insert was interrupted", exception);
        } catch (Exception exception) {
            throw new AssertionError("concurrent comment insert failed", exception);
        }
    }

    private record AliasRow(UUID userId, int ordinal) {
    }

    private record CommentResult(int ordinal, UUID commentId, int backendPid) {
    }

    private static final class IntentionalRollback extends RuntimeException {
    }
}
