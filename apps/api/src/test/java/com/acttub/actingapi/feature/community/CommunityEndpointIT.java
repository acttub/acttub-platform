package com.acttub.actingapi.feature.community;

import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import com.acttub.actingapi.feature.auth.app.JwtService;
import com.acttub.actingapi.feature.community.app.CommunityService;
import com.acttub.actingapi.support.PostgresContainerSupport;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest(properties = "JWT_SECRET=test-secret")
@AutoConfigureMockMvc
class CommunityEndpointIT {
    private static final UUID VIEWER =
            UUID.fromString("00000000-0000-4000-8000-000000000401");
    private static final UUID OTHER =
            UUID.fromString("00000000-0000-4000-8000-000000000402");
    private static final UUID THIRD =
            UUID.fromString("00000000-0000-4000-8000-000000000403");
    private static final UUID FOURTH =
            UUID.fromString("00000000-0000-4000-8000-000000000404");

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        String name = PostgresContainerSupport.createDatabaseName("community_endpoint");
        registry.add("spring.datasource.url", () -> PostgresContainerSupport.jdbcUrlFor(name));
        registry.add("spring.datasource.username", PostgresContainerSupport.POSTGRES::getUsername);
        registry.add("spring.datasource.password", PostgresContainerSupport.POSTGRES::getPassword);
    }

    @Autowired
    MockMvc mvc;

    @Autowired
    JdbcTemplate jdbc;

    @Autowired
    JwtService jwt;

    @Autowired
    ObjectMapper mapper;

    @Autowired
    CommunityService community;

    @BeforeEach
    void setUp() {
        jdbc.execute("TRUNCATE TABLE users, consent_documents RESTART IDENTITY CASCADE");
        insertUser(VIEWER, "viewer");
        insertUser(OTHER, "other");
        insertUser(THIRD, "third");
        insertUser(FOURTH, "fourth");
    }

    @Test
    void blockFilterHidesNamedContentButKeepsAnonymousPostsAndComments() throws Exception {
        UUID namedPost = insertPost(OTHER, false, at(1));
        UUID anonymousPost = insertPost(OTHER, true, at(2));
        UUID discussion = insertPost(THIRD, false, at(3));
        UUID namedComment = insertComment(discussion, OTHER, false, at(1));
        UUID anonymousComment = insertComment(discussion, OTHER, true, at(2));

        var blocked = mvc.perform(post("/v2/community/blocks")
                        .header("Authorization", bearer(VIEWER))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"user_id\":\"" + OTHER + "\"}"))
                .andReturn().getResponse();
        assertThat(blocked.getStatus()).isEqualTo(204);

        JsonNode posts = json(mvc.perform(get("/v2/community/posts")
                        .header("Authorization", bearer(VIEWER))
                        .param("limit", "50"))
                .andReturn().getResponse().getContentAsString());
        List<String> postIds = values(posts.path("posts"), "id");
        assertThat(postIds).contains(anonymousPost.toString(), discussion.toString());
        assertThat(postIds).doesNotContain(namedPost.toString());

        JsonNode comments = json(mvc.perform(get(
                        "/v2/community/posts/{post_id}/comments", discussion)
                        .header("Authorization", bearer(VIEWER)))
                .andReturn().getResponse().getContentAsString());
        assertThat(values(comments.path("comments"), "id"))
                .containsExactly(anonymousComment.toString())
                .doesNotContain(namedComment.toString());

        assertThat(mvc.perform(get("/v2/community/posts/{post_id}", namedPost)
                        .header("Authorization", bearer(VIEWER)))
                .andReturn().getResponse().getStatus()).isEqualTo(404);
        assertThat(mvc.perform(get("/v2/community/posts/{post_id}", anonymousPost)
                        .header("Authorization", bearer(VIEWER)))
                .andReturn().getResponse().getStatus()).isEqualTo(200);

        assertThat(mvc.perform(get("/v2/community/posts").param("limit", "50"))
                .andReturn().getResponse().getStatus()).isEqualTo(200);

        assertPostValidationContract();
    }

    @Test
    void detailReturnsTheViewCountBeforeItsSeparateAtomicIncrement() throws Exception {
        UUID postId = insertPost(OTHER, false, at(1));
        jdbc.update("UPDATE community_posts SET view_count = 7 WHERE id = ?", postId);

        JsonNode first = json(mvc.perform(get("/v2/community/posts/{post_id}", postId)
                        .header("Authorization", bearer(VIEWER)))
                .andReturn().getResponse().getContentAsString());
        assertThat(first.path("view_count").intValue()).isEqualTo(7);
        assertThat(viewCount(postId)).isEqualTo(8);

        JsonNode second = json(mvc.perform(get("/v2/community/posts/{post_id}", postId)
                        .header("Authorization", bearer(VIEWER)))
                .andReturn().getResponse().getContentAsString());
        assertThat(second.path("view_count").intValue()).isEqualTo(8);
        assertThat(viewCount(postId)).isEqualTo(9);

        mvc.perform(get("/v2/community/posts/{post_id}", postId)
                .header("Authorization", bearer(OTHER)));
        assertThat(viewCount(postId)).isEqualTo(9);
    }

    @Test
    void postCursorIsDescendingAndCommentCursorIsAscending() throws Exception {
        UUID oldest = insertPost(VIEWER, false, at(1));
        UUID middle = insertPost(VIEWER, false, at(2));
        UUID newest = insertPost(VIEWER, false, at(3));

        JsonNode firstPosts = json(mvc.perform(get("/v2/community/posts").param("limit", "2"))
                .andReturn().getResponse().getContentAsString());
        assertThat(values(firstPosts.path("posts"), "id"))
                .containsExactly(newest.toString(), middle.toString());
        JsonNode lastPosts = json(mvc.perform(get("/v2/community/posts")
                        .param("limit", "2")
                        .param("cursor", firstPosts.path("next_cursor").textValue()))
                .andReturn().getResponse().getContentAsString());
        assertThat(values(lastPosts.path("posts"), "id")).containsExactly(oldest.toString());
        assertThat(lastPosts.path("next_cursor").isNull()).isTrue();

        UUID first = insertComment(oldest, OTHER, false, at(4));
        UUID second = insertComment(oldest, THIRD, false, at(5));
        UUID third = insertComment(oldest, FOURTH, false, at(6));
        JsonNode firstComments = json(mvc.perform(get(
                        "/v2/community/posts/{post_id}/comments", oldest)
                        .param("limit", "2"))
                .andReturn().getResponse().getContentAsString());
        assertThat(values(firstComments.path("comments"), "id"))
                .containsExactly(first.toString(), second.toString());
        JsonNode lastComments = json(mvc.perform(get(
                        "/v2/community/posts/{post_id}/comments", oldest)
                        .param("limit", "2")
                        .param("cursor", firstComments.path("next_cursor").textValue()))
                .andReturn().getResponse().getContentAsString());
        assertThat(values(lastComments.path("comments"), "id"))
                .containsExactly(third.toString());
        assertThat(lastComments.path("next_cursor").isNull()).isTrue();
    }

    @Test
    void concurrentCommentCreationKeepsThePostCountAtomic() throws Exception {
        UUID postId = insertPost(VIEWER, false, at(1));
        CountDownLatch ready = new CountDownLatch(2);
        CountDownLatch start = new CountDownLatch(1);
        ExecutorService executor = Executors.newFixedThreadPool(2);
        try {
            Future<UUID> first = executor.submit(() -> createAfterLatch(postId, OTHER, ready, start));
            Future<UUID> second = executor.submit(() -> createAfterLatch(postId, THIRD, ready, start));
            assertThat(ready.await(5, TimeUnit.SECONDS)).isTrue();
            start.countDown();

            assertThat(List.of(first.get(5, TimeUnit.SECONDS), second.get(5, TimeUnit.SECONDS)))
                    .doesNotHaveDuplicates();
            assertThat(jdbc.queryForObject(
                    "SELECT comment_count FROM community_posts WHERE id = ?",
                    Integer.class,
                    postId)).isEqualTo(2);
            assertThat(jdbc.queryForObject(
                    "SELECT COUNT(*) FROM community_comments WHERE post_id = ?",
                    Integer.class,
                    postId)).isEqualTo(2);
        } finally {
            start.countDown();
            executor.shutdownNow();
            executor.awaitTermination(5, TimeUnit.SECONDS);
        }
    }

    @Test
    void simultaneousLikesByDifferentUsersAreBothCounted() throws Exception {
        UUID postId = insertPost(VIEWER, false, at(1));

        assertThat(overlappingLikes(postId,
                () -> changeLike(postId, OTHER, true),
                () -> changeLike(postId, THIRD, true)))
                .containsExactlyInAnyOrder(1, 2);

        assertLikeState(postId, OTHER, 2, true);
        assertLikeState(postId, THIRD, 2, true);
    }

    @Test
    void overlappingLikeAndUnlikeKeepTheRemainingUsersLike() throws Exception {
        UUID postId = insertPost(VIEWER, false, at(1));
        assertThat(changeLike(postId, OTHER, true)).isEqualTo(1);

        assertThat(overlappingLikes(postId,
                () -> changeLike(postId, THIRD, true),
                () -> changeLike(postId, OTHER, false)))
                .containsExactly(2, 1);
        assertLikeState(postId, OTHER, 1, false);
        assertLikeState(postId, THIRD, 1, true);

        assertThat(overlappingLikes(postId,
                () -> changeLike(postId, THIRD, false),
                () -> changeLike(postId, OTHER, true)))
                .containsExactly(0, 1);
        assertLikeState(postId, OTHER, 1, true);
        assertLikeState(postId, THIRD, 1, false);
    }

    @Test
    void duplicateLikeResynchronizesInsteadOfIncrementingTheCachedCount() throws Exception {
        UUID postId = insertPost(VIEWER, false, at(1));
        jdbc.update("UPDATE community_posts SET like_count = 41 WHERE id = ?", postId);

        assertThat(changeLike(postId, OTHER, true)).isEqualTo(1);
        jdbc.update("UPDATE community_posts SET like_count = 41 WHERE id = ?", postId);
        assertThat(overlappingLikes(postId,
                () -> changeLike(postId, OTHER, true),
                () -> changeLike(postId, OTHER, true))).containsExactly(1, 1);
        assertLikeState(postId, OTHER, 1, true);

        assertThat(changeLike(postId, THIRD, true)).isEqualTo(2);
        assertThat(overlappingLikes(postId,
                () -> changeLike(postId, OTHER, false),
                () -> changeLike(postId, OTHER, false))).containsExactly(1, 1);
        assertLikeState(postId, OTHER, 1, false);
        assertLikeState(postId, THIRD, 1, true);

        jdbc.update("UPDATE community_posts SET like_count = 41 WHERE id = ?", postId);
        assertThat(changeLike(postId, OTHER, false)).isEqualTo(1);
        assertLikeState(postId, OTHER, 1, false);
        assertThat(changeLike(postId, THIRD, false)).isZero();
        assertThat(changeLike(postId, THIRD, false)).isZero();
        assertLikeState(postId, THIRD, 0, false);
    }

    private List<Integer> overlappingLikes(
            UUID postId, Callable<Integer> firstRequest, Callable<Integer> secondRequest)
            throws Exception {
        ExecutorService executor = Executors.newFixedThreadPool(2);
        try (var connection = jdbc.getDataSource().getConnection()) {
            connection.setAutoCommit(false);
            try {
                // FK checks may proceed, but both HTTP requests must overlap before release.
                // SQL only controls timing; responses and subsequent HTTP reads decide correctness.
                try (var lock = connection.prepareStatement(
                        "SELECT id FROM community_posts WHERE id = ? FOR NO KEY UPDATE")) {
                    lock.setObject(1, postId);
                    lock.executeQuery().close();
                }
                Future<Integer> first = executor.submit(firstRequest);
                awaitBlockedPostRequests(1);
                Future<Integer> second = executor.submit(secondRequest);
                awaitBlockedPostRequests(2);
                connection.rollback();
                return List.of(first.get(10, TimeUnit.SECONDS), second.get(10, TimeUnit.SECONDS));
            } finally {
                connection.rollback();
            }
        } finally {
            executor.shutdownNow();
            assertThat(executor.awaitTermination(10, TimeUnit.SECONDS)).isTrue();
        }
    }

    @Test
    void likesAndUnlikesRejectMissingHiddenAndDeletedPostsWithoutChangingLikes() throws Exception {
        UUID postId = insertPost(VIEWER, false, at(1));
        assertThat(changeLike(postId, OTHER, true)).isEqualTo(1);

        for (String status : List.of("hidden", "deleted")) {
            jdbc.update("UPDATE community_posts SET status = ? WHERE id = ?", status, postId);
            assertLikeNotFound(postId, THIRD, true);
            assertLikeNotFound(postId, OTHER, false);
            var detail = mvc.perform(get("/v2/community/posts/{post_id}", postId))
                    .andReturn().getResponse();
            assertThat(detail.getStatus()).isEqualTo(404);
            assertThat(json(detail.getContentAsString()).path("detail").textValue())
                    .isEqualTo("post_not_found");

            jdbc.update("UPDATE community_posts SET status = 'visible' WHERE id = ?", postId);
            assertLikeState(postId, OTHER, 1, true);
            assertLikeState(postId, THIRD, 1, false);
        }
        UUID missing = UUID.randomUUID();
        assertLikeNotFound(missing, OTHER, true);
        assertLikeNotFound(missing, OTHER, false);
    }

    private void assertLikeNotFound(UUID postId, UUID userId, boolean like) throws Exception {
        var response = requestLike(postId, userId, like);
        assertThat(response.getStatus()).isEqualTo(404);
        assertThat(json(response.getContentAsString()).path("detail").textValue())
                .isEqualTo("post_not_found");
    }

    private void awaitBlockedPostRequests(int count) {
        await().atMost(10, TimeUnit.SECONDS).untilAsserted(() ->
                assertThat(jdbc.queryForObject("""
                        SELECT COUNT(*) FROM pg_stat_activity
                        WHERE datname = current_database() AND pid <> pg_backend_pid()
                          AND wait_event_type = 'Lock' AND query ILIKE '%community_posts%'
                        """, Integer.class)).isEqualTo(count));
    }

    private int changeLike(UUID postId, UUID userId, boolean like) throws Exception {
        var response = requestLike(postId, userId, like);
        assertThat(response.getStatus()).isEqualTo(200);
        assertThat(json(response.getContentAsString()).path("liked_by_me").booleanValue())
                .isEqualTo(like);
        return json(response.getContentAsString()).path("like_count").intValue();
    }

    private MockHttpServletResponse requestLike(UUID postId, UUID userId, boolean like)
            throws Exception {
        var request = like
                ? post("/v2/community/posts/{post_id}/likes", postId)
                : delete("/v2/community/posts/{post_id}/likes", postId);
        return mvc.perform(request.header("Authorization", bearer(userId)))
                .andReturn().getResponse();
    }

    private void assertLikeState(UUID postId, UUID viewerId, int count, boolean liked)
            throws Exception {
        var response = mvc.perform(get("/v2/community/posts/{post_id}", postId)
                        .header("Authorization", bearer(viewerId)))
                .andReturn().getResponse();
        assertThat(response.getStatus()).isEqualTo(200);
        JsonNode detail = json(response.getContentAsString());
        assertThat(detail.path("like_count").intValue()).isEqualTo(count);
        assertThat(detail.path("liked_by_me").booleanValue()).isEqualTo(liked);

        var listResponse = mvc.perform(get("/v2/community/posts")
                        .header("Authorization", bearer(viewerId)))
                .andReturn().getResponse();
        assertThat(listResponse.getStatus()).isEqualTo(200);
        JsonNode posts = json(listResponse.getContentAsString()).path("posts");
        assertThat(posts).hasSize(1);
        assertThat(posts.get(0).path("id").textValue()).isEqualTo(postId.toString());
        assertThat(posts.get(0).path("like_count").intValue()).isEqualTo(count);
        assertThat(posts.get(0).path("liked_by_me").booleanValue()).isEqualTo(liked);
    }

    @Test
    void anonymousPostAuthorKeepsTheWriterAliasOnTheirAnonymousComment() throws Exception {
        var postResponse = mvc.perform(post("/v2/community/posts")
                        .header("Authorization", bearer(VIEWER))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"category_slug":"free","title":"익명 글",
                                 "body":"익명 본문","anonymous":true}
                                """))
                .andReturn().getResponse();
        assertThat(postResponse.getStatus()).isEqualTo(201);
        JsonNode createdPost = json(postResponse.getContentAsString());
        assertThat(createdPost.path("anonymous").booleanValue()).isTrue();
        assertThat(createdPost.path("author").path("alias").textValue()).isEqualTo("익명");

        UUID postId = UUID.fromString(createdPost.path("id").textValue());
        var commentResponse = mvc.perform(post(
                        "/v2/community/posts/{post_id}/comments", postId)
                        .header("Authorization", bearer(VIEWER))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"body\":\"글쓴이 댓글\",\"anonymous\":true}"))
                .andReturn().getResponse();
        assertThat(commentResponse.getStatus()).isEqualTo(201);
        JsonNode createdComment = json(commentResponse.getContentAsString());
        assertThat(createdComment.path("anonymous").booleanValue()).isTrue();
        assertThat(createdComment.path("author").path("alias").textValue())
                .isEqualTo("글쓴이");
        assertThat(jdbc.queryForObject("""
                SELECT COUNT(*)
                FROM community_anonymous_aliases
                WHERE post_id = ?
                """, Integer.class, postId)).isZero();
    }

    @Test
    void reportKeepsItsReasonAndDetail() throws Exception {
        UUID postId = insertPost(OTHER, false, at(1));

        var response = mvc.perform(post("/v2/community/reports")
                        .header("Authorization", bearer(VIEWER))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"target_type":"post","target_id":"%s",
                                 "reason":"other","detail":"직접 적은 신고 근거"}
                                """.formatted(postId)))
                .andReturn().getResponse();

        assertThat(response.getStatus()).isEqualTo(204);
        assertThat(jdbc.queryForMap("""
                SELECT target_type, reason, detail, status
                FROM community_reports
                WHERE reporter_id = ? AND target_id = ?
                """, VIEWER, postId))
                .containsEntry("target_type", "post")
                .containsEntry("reason", "other")
                .containsEntry("detail", "직접 적은 신고 근거")
                .containsEntry("status", "pending");
    }

    @Test
    void postMutationsAdvanceUpdatedAtWithoutChangingCreatedAt() throws Exception {
        UUID updatedPost = insertPost(VIEWER, false, at(1));
        UUID deletedPost = insertPost(VIEWER, false, at(2));

        var updateResponse = mvc.perform(patch("/v2/community/posts/{post_id}", updatedPost)
                        .header("Authorization", bearer(VIEWER))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"title\":\"바뀐 제목\",\"body\":\"바뀐 본문\"}"))
                .andReturn().getResponse();
        assertThat(updateResponse.getStatus()).isEqualTo(200);
        assertThat(OffsetDateTime.parse(json(updateResponse.getContentAsString())
                .path("updated_at").textValue())).isAfter(at(1));

        var deleteResponse = mvc.perform(delete("/v2/community/posts/{post_id}", deletedPost)
                        .header("Authorization", bearer(VIEWER)))
                .andReturn().getResponse();
        assertThat(deleteResponse.getStatus()).isEqualTo(204);

        assertStoredTimes(updatedPost, "community_posts", at(1), "visible");
        assertStoredTimes(deletedPost, "community_posts", at(2), "deleted");
    }

    @Test
    void commentMutationsAdvanceUpdatedAtWithoutChangingCreatedAt() throws Exception {
        UUID postId = insertPost(VIEWER, false, at(1));
        UUID updatedComment = insertComment(postId, VIEWER, false, at(2));
        UUID deletedComment = insertComment(postId, VIEWER, false, at(3));

        var updateResponse = mvc.perform(patch(
                        "/v2/community/comments/{comment_id}", updatedComment)
                        .header("Authorization", bearer(VIEWER))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"body\":\"바뀐 댓글\"}"))
                .andReturn().getResponse();
        assertThat(updateResponse.getStatus()).isEqualTo(200);
        assertThat(OffsetDateTime.parse(json(updateResponse.getContentAsString())
                .path("updated_at").textValue())).isAfter(at(2));

        var deleteResponse = mvc.perform(delete(
                        "/v2/community/comments/{comment_id}", deletedComment)
                        .header("Authorization", bearer(VIEWER)))
                .andReturn().getResponse();
        assertThat(deleteResponse.getStatus()).isEqualTo(204);

        assertStoredTimes(updatedComment, "community_comments", at(2), "visible");
        assertStoredTimes(deletedComment, "community_comments", at(3), "deleted");
    }

    private void assertPostValidationContract() throws Exception {
        assertPostValidation(
                "{\"category_slug\":\"free\",\"title\":\"\",\"body\":\"\",\"anonymous\":false}",
                """
                {"detail":[
                  {"type":"string_too_short","loc":["body","title"],
                   "msg":"String should have at least 1 character","input":"",
                   "ctx":{"min_length":1}},
                  {"type":"string_too_short","loc":["body","body"],
                   "msg":"String should have at least 1 character","input":"",
                   "ctx":{"min_length":1}}
                ]}
                """);
        assertPostValidation(
                "{\"category_slug\":\"free\",\"title\":1,\"body\":2,\"anonymous\":false}",
                """
                {"detail":[
                  {"type":"string_type","loc":["body","title"],
                   "msg":"Input should be a valid string","input":1},
                  {"type":"string_type","loc":["body","body"],
                   "msg":"Input should be a valid string","input":2}
                ]}
                """);
        assertPostValidation(
                "{\"category_slug\":\"free\",\"title\":\"제목\",\"body\":\"본문\",\"anonymous\":null}",
                """
                {"detail":[{"type":"bool_type","loc":["body","anonymous"],
                  "msg":"Input should be a valid boolean","input":null}]}
                """);
        assertPostValidation(
                "{\"category_slug\":\"free\",\"title\":null,\"body\":\"본문\"}",
                """
                {"detail":[{"type":"string_type","loc":["body","title"],
                  "msg":"Input should be a valid string","input":null}]}
                """);

        var omitted = mvc.perform(post("/v2/community/posts")
                        .header("Authorization", bearer(VIEWER))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"category_slug\":\"free\",\"title\":\"제목\",\"body\":\"본문\"}"))
                .andReturn().getResponse();
        assertThat(omitted.getStatus()).isEqualTo(201);
        assertThat(mapper.readTree(omitted.getContentAsString()).path("anonymous").booleanValue())
                .isFalse();
    }

    private void assertPostValidation(String request, String expected) throws Exception {
        var response = mvc.perform(post("/v2/community/posts")
                        .header("Authorization", bearer(VIEWER))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(request))
                .andReturn().getResponse();
        assertThat(response.getStatus()).isEqualTo(422);
        assertThat(mapper.readTree(response.getContentAsString()))
                .isEqualTo(mapper.readTree(expected));
    }

    private UUID createAfterLatch(
            UUID postId,
            UUID authorId,
            CountDownLatch ready,
            CountDownLatch start) throws Exception {
        ready.countDown();
        assertThat(start.await(5, TimeUnit.SECONDS)).isTrue();
        return community.createComment(postId, authorId, "동시 댓글", false).id();
    }

    private void insertUser(UUID id, String nickname) {
        jdbc.update("""
                INSERT INTO users(id, email, nickname, status)
                VALUES (?, NULL, ?, 'active')
                """, id, nickname);
    }

    private UUID insertPost(UUID authorId, boolean anonymous, OffsetDateTime createdAt) {
        UUID id = UUID.randomUUID();
        UUID categoryId = jdbc.queryForObject(
                "SELECT id FROM community_categories WHERE slug = 'free'",
                UUID.class);
        jdbc.update("""
                INSERT INTO community_posts (
                    id, category_id, author_id, title, body, anonymous, status,
                    created_at, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, 'visible', ?, ?)
                """, id, categoryId, authorId, "제목 " + id, "본문", anonymous,
                createdAt, createdAt);
        return id;
    }

    private UUID insertComment(
            UUID postId,
            UUID authorId,
            boolean anonymous,
            OffsetDateTime createdAt) {
        UUID id = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO community_comments (
                    id, post_id, author_id, body, anonymous, status, created_at, updated_at
                )
                VALUES (?, ?, ?, '댓글', ?, 'visible', ?, ?)
                """, id, postId, authorId, anonymous, createdAt, createdAt);
        jdbc.update("""
                UPDATE community_posts SET comment_count = comment_count + 1 WHERE id = ?
                """, postId);
        if (anonymous) {
            jdbc.update("""
                    INSERT INTO community_anonymous_aliases(id, post_id, user_id, ordinal)
                    VALUES (?, ?, ?, 1)
                    """, UUID.randomUUID(), postId, authorId);
        }
        return id;
    }

    private int viewCount(UUID postId) {
        return jdbc.queryForObject(
                "SELECT view_count FROM community_posts WHERE id = ?",
                Integer.class,
                postId);
    }

    private void assertStoredTimes(
            UUID id,
            String table,
            OffsetDateTime expectedCreatedAt,
            String expectedStatus) {
        OffsetDateTime createdAt = jdbc.queryForObject("""
                SELECT created_at
                FROM %s
                WHERE id = ?
                """.formatted(table), OffsetDateTime.class, id);
        OffsetDateTime updatedAt = jdbc.queryForObject("""
                SELECT updated_at
                FROM %s
                WHERE id = ?
                """.formatted(table), OffsetDateTime.class, id);
        String status = jdbc.queryForObject("""
                SELECT status
                FROM %s
                WHERE id = ?
                """.formatted(table), String.class, id);
        assertThat(createdAt).isEqualTo(expectedCreatedAt);
        assertThat(updatedAt).isAfter(expectedCreatedAt);
        assertThat(status).isEqualTo(expectedStatus);
    }

    private String bearer(UUID userId) {
        return "Bearer " + jwt.issueAccessToken(userId).value();
    }

    private JsonNode json(String body) throws Exception {
        return mapper.readTree(body);
    }

    private static List<String> values(JsonNode array, String field) {
        java.util.ArrayList<String> result = new java.util.ArrayList<>();
        array.forEach(item -> result.add(item.path(field).textValue()));
        return result;
    }

    private static OffsetDateTime at(int second) {
        return OffsetDateTime.of(2026, 8, 8, 1, 2, second, 456789000, ZoneOffset.UTC);
    }
}
