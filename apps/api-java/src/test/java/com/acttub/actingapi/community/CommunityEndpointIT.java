package com.acttub.actingapi.community;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import com.acttub.actingapi.auth.JwtService;
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
    CommunityStore store;

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
    void cursorParsesPythonOffsetLiteralAndEmitsTheSameOffsetSpelling() {
        String pythonIssued =
                "MjAyNi0wOC0wOFQwMTowMjowMy40NTY3ODkrMDA6MDB8"
                        + "MDAwMDAwMDAtMDAwMC00MDAwLTgwMDAtMDAwMDAwMDAwNzc3";

        CommunityCursor.Cursor decoded = CommunityCursor.decode(pythonIssued);

        assertThat(decoded.createdAt())
                .isEqualTo(OffsetDateTime.of(2026, 8, 8, 1, 2, 3, 456789000, ZoneOffset.UTC));
        assertThat(decoded.id())
                .isEqualTo(UUID.fromString("00000000-0000-4000-8000-000000000777"));
        assertThat(CommunityCursor.encode(decoded.createdAt(), decoded.id()))
                .isEqualTo(pythonIssued);

        String zSpelling = java.util.Base64.getUrlEncoder().withoutPadding().encodeToString(
                "2026-08-08T01:02:03.456789Z|00000000-0000-4000-8000-000000000777"
                        .getBytes(java.nio.charset.StandardCharsets.UTF_8));
        assertThat(CommunityCursor.decode(zSpelling)).isEqualTo(decoded);
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
    void duplicateLikeResynchronizesInsteadOfIncrementingTheCachedCount() {
        UUID postId = insertPost(VIEWER, false, at(1));
        jdbc.update("UPDATE community_posts SET like_count = 41 WHERE id = ?", postId);

        assertThat(store.likePost(postId, OTHER)).isEqualTo(1);
        assertThat(store.likePost(postId, OTHER)).isEqualTo(1);
        assertThat(jdbc.queryForObject(
                "SELECT like_count FROM community_posts WHERE id = ?",
                Integer.class,
                postId)).isEqualTo(1);
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
        return store.createComment(postId, authorId, "동시 댓글", false).id();
    }

    private void insertUser(UUID id, String nickname) {
        jdbc.update("""
                INSERT INTO users(id, email, nickname, status)
                VALUES (?, NULL, ?, 'active'::user_status_t)
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
                VALUES (?, ?, ?, ?, ?, ?, 'visible'::content_status_t, ?, ?)
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
                VALUES (?, ?, ?, '댓글', ?, 'visible'::content_status_t, ?, ?)
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
