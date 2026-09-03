package com.acttub.actingapi.feature.community;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.UUID;

import com.acttub.actingapi.feature.auth.app.JwtService;
import com.acttub.actingapi.support.PostgresContainerSupport;
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
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

/**
 * 커뮤니티 오류 계약 — {@code CommunityService} 가 내는 (status, detail) 전량.
 *
 * <p><b>계약 하네스에서 옮겨 온 기대값이다</b>(SOMA-403 2단계). 하네스는 FastAPI 응답과
 * 비교해 판정했지만 파이썬이 사라지면 비교 대상이 없다 — 그래서 여기 적힌 것은 비교가 아니라
 * <b>고정 기대값</b>이다. 옮기기 전 하네스 manifest 의 community 케이스 21건이 Java 테스트
 * 어디에도 없었다: {@code CommunityEndpointIT} 는 차단 필터·커서·조회수·좋아요 재집계만 본다.
 *
 * <p><b>같은 detail 을 여러 엔드포인트가 쓴다.</b> {@code CommunityService} 는
 * {@code postNotFound()}·{@code commentNotFound()}·{@code notAuthor()} 헬퍼로 한 곳에서
 * 만들므로 소스에는 {@code new ApiException} 이 각각 하나뿐이지만, <b>그것을 부르는 연산은
 * 여럿이다.</b> 헬퍼가 늘거나 한 연산이 다른 코드로 갈아타는 것을 인벤토리 검사기는 보지
 * 못하므로(→ {@code ErrorContractInventoryTest}), 경로마다 따로 때린다.
 */
@SpringBootTest(properties = "JWT_SECRET=test-secret")
@AutoConfigureMockMvc
class CommunityErrorContractIT {
    private static final UUID AUTHOR =
            UUID.fromString("00000000-0000-4000-8000-000000000501");
    private static final UUID STRANGER =
            UUID.fromString("00000000-0000-4000-8000-000000000502");
    private static final UUID MISSING =
            UUID.fromString("00000000-0000-4000-8000-0000000005ff");

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        String name = PostgresContainerSupport.createDatabaseName("community_error");
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

    @BeforeEach
    void setUp() {
        jdbc.execute("TRUNCATE TABLE users, consent_documents RESTART IDENTITY CASCADE");
        insertUser(AUTHOR, "author");
        insertUser(STRANGER, "stranger");
    }

    /**
     * 글이 없을 때 나는 404 는 여섯 연산이 공유하고, 댓글 쪽은 자기 코드({@code
     * comment_not_found})를 쓴다. <b>둘을 서로 바꿔치기해도 상태코드는 같으므로</b> detail
     * 까지 단언한다.
     */
    @Test
    void everyPostOperationSaysPostNotFoundAndCommentOperationsSayCommentNotFound()
            throws Exception {
        assertError(authed(get("/v2/community/posts/{id}", MISSING), STRANGER),
                404, "post_not_found");
        assertError(authed(patch("/v2/community/posts/{id}", MISSING), STRANGER)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"title\":\"제목\",\"body\":\"본문\"}"),
                404, "post_not_found");
        assertError(authed(delete("/v2/community/posts/{id}", MISSING), STRANGER),
                404, "post_not_found");
        assertError(authed(post("/v2/community/posts/{id}/likes", MISSING), STRANGER),
                404, "post_not_found");
        assertError(authed(delete("/v2/community/posts/{id}/likes", MISSING), STRANGER),
                404, "post_not_found");
        assertError(authed(get("/v2/community/posts/{id}/comments", MISSING), STRANGER),
                404, "post_not_found");
        assertError(authed(post("/v2/community/posts/{id}/comments", MISSING), STRANGER)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"body\":\"댓글\",\"anonymous\":false}"),
                404, "post_not_found");

        assertError(authed(patch("/v2/community/comments/{id}", MISSING), STRANGER)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"body\":\"댓글\",\"anonymous\":false}"),
                404, "comment_not_found");
        assertError(authed(delete("/v2/community/comments/{id}", MISSING), STRANGER),
                404, "comment_not_found");
    }

    /**
     * 남의 글·댓글을 고치거나 지우면 404 가 아니라 403 이다. 존재는 하되 권한이 없다는 뜻이라,
     * 여기서 404 로 뭉개면 "없는 글" 과 "남의 글" 을 구별하지 못한다.
     */
    @Test
    void mutatingSomeoneElsesContentIsForbiddenRatherThanNotFound() throws Exception {
        UUID postId = insertPost(AUTHOR);
        UUID commentId = insertComment(postId, AUTHOR);

        assertError(authed(patch("/v2/community/posts/{id}", postId), STRANGER)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"title\":\"제목\",\"body\":\"본문\"}"),
                403, "not_author");
        assertError(authed(delete("/v2/community/posts/{id}", postId), STRANGER),
                403, "not_author");
        assertError(authed(patch("/v2/community/comments/{id}", commentId), STRANGER)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"body\":\"댓글\",\"anonymous\":false}"),
                403, "not_author");
        assertError(authed(delete("/v2/community/comments/{id}", commentId), STRANGER),
                403, "not_author");
    }

    @Test
    void writingToAnUnknownCategoryIsCategoryNotFound() throws Exception {
        assertError(authed(post("/v2/community/posts"), AUTHOR)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"category_slug":"does-not-exist","title":"제목",
                                 "body":"본문","anonymous":false}
                                """),
                404, "category_not_found");
    }

    /** 커서는 목록 둘이 각자 해독하고, 어느 쪽이든 해독 실패는 400 이다(422 가 아니다). */
    @Test
    void malformedCursorsAreRejectedOnBothListings() throws Exception {
        UUID postId = insertPost(AUTHOR);

        assertError(get("/v2/community/posts").param("cursor", "not-a-cursor"),
                400, "invalid_cursor");
        assertError(get("/v2/community/posts/{id}/comments", postId)
                        .param("cursor", "not-a-cursor"),
                400, "invalid_cursor");
    }

    /**
     * 신고는 세 갈래로 거절된다. <b>자기 것 신고(400)가 중복 신고(409)보다 먼저</b> 판정되는지는
     * 여기서 보지 않는다 — 자기 것은 애초에 첫 신고가 서지 않아 중복이 될 수 없다.
     */
    @Test
    void reportRejectsMissingTargetOwnContentAndDuplicates() throws Exception {
        UUID ownPost = insertPost(AUTHOR);
        UUID othersPost = insertPost(STRANGER);

        assertError(authed(post("/v2/community/reports"), AUTHOR)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(reportBody("post", MISSING)),
                404, "target_not_found");
        assertError(authed(post("/v2/community/reports"), AUTHOR)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(reportBody("post", ownPost)),
                400, "cannot_report_own");

        assertThat(mvc.perform(authed(post("/v2/community/reports"), AUTHOR)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(reportBody("post", othersPost)))
                .andReturn().getResponse().getStatus()).isEqualTo(204);
        assertError(authed(post("/v2/community/reports"), AUTHOR)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(reportBody("post", othersPost)),
                409, "already_reported");
    }

    /**
     * 자기 차단은 400, 없는 사람 차단은 404 다. <b>자기 자신인지를 실재 확인보다 먼저</b> 보는
     * 순서가 계약이다 — 뒤집으면 자기 id 는 늘 실재하므로 400 이 나오지 않는다.
     */
    @Test
    void blockRejectsSelfBeforeItChecksThatTheTargetExists() throws Exception {
        assertError(authed(post("/v2/community/blocks"), AUTHOR)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"user_id\":\"" + AUTHOR + "\"}"),
                400, "cannot_block_self");
        assertError(authed(post("/v2/community/blocks"), AUTHOR)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"user_id\":\"" + MISSING + "\"}"),
                404, "user_not_found");
    }

    private static String reportBody(String targetType, UUID targetId) {
        return "{\"target_type\":\"" + targetType + "\",\"target_id\":\"" + targetId
                + "\",\"reason\":\"spam\",\"detail\":null}";
    }

    private MockHttpServletRequestBuilder authed(
            MockHttpServletRequestBuilder request, UUID userId) {
        return request.header("Authorization", "Bearer " + jwt.issueAccessToken(userId).value());
    }

    private void assertError(
            MockHttpServletRequestBuilder request, int status, String detail) throws Exception {
        MvcResult result = mvc.perform(request).andReturn();
        assertThat(result.getResponse().getStatus())
                .as("기대한 상태코드 %d, detail=%s", status, detail)
                .isEqualTo(status);
        assertThat(mapper.readTree(result.getResponse().getContentAsString()))
                .isEqualTo(mapper.readTree("{\"detail\":\"" + detail + "\"}"));
    }

    private void insertUser(UUID id, String nickname) {
        jdbc.update("""
                INSERT INTO users(id, email, nickname, status)
                VALUES (?, NULL, ?, 'active')
                """, id, nickname);
    }

    private UUID insertPost(UUID authorId) {
        UUID id = UUID.randomUUID();
        UUID categoryId = jdbc.queryForObject(
                "SELECT id FROM community_categories WHERE slug = 'free'",
                UUID.class);
        OffsetDateTime at = OffsetDateTime.of(2026, 8, 8, 1, 2, 3, 456789000, ZoneOffset.UTC);
        jdbc.update("""
                INSERT INTO community_posts (
                    id, category_id, author_id, title, body, anonymous, status,
                    created_at, updated_at
                )
                VALUES (?, ?, ?, ?, '본문', false, 'visible', ?, ?)
                """, id, categoryId, authorId, "제목 " + id, at, at);
        return id;
    }

    private UUID insertComment(UUID postId, UUID authorId) {
        UUID id = UUID.randomUUID();
        OffsetDateTime at = OffsetDateTime.of(2026, 8, 8, 1, 2, 4, 456789000, ZoneOffset.UTC);
        jdbc.update("""
                INSERT INTO community_comments (
                    id, post_id, author_id, body, anonymous, status, created_at, updated_at
                )
                VALUES (?, ?, ?, '댓글', false, 'visible', ?, ?)
                """, id, postId, authorId, at, at);
        jdbc.update("UPDATE community_posts SET comment_count = comment_count + 1 WHERE id = ?",
                postId);
        return id;
    }
}
