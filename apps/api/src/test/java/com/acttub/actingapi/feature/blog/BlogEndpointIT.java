package com.acttub.actingapi.feature.blog;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;

import com.acttub.actingapi.integration.storage.ObjectStorage;
import com.acttub.actingapi.integration.storage.StoredObjectMetadata;
import com.acttub.actingapi.support.PostgresContainerSupport;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

/** app.blog — 로그인 없이 읽는 공개 경로와 운영 토큰으로 여는 관리 경로. */
@SpringBootTest(properties = {"JWT_SECRET=test-secret", "ADMIN_OPS_TOKEN=admin-secret",
        "ACCOUNT_CLEANUP_ENABLED=false", "ACCOUNT_HOUSEKEEPING_ENABLED=false"})
@AutoConfigureMockMvc
@Import(BlogEndpointIT.StorageFixture.class)
class BlogEndpointIT {
    private static final String ADMIN = "Bearer admin-secret";
    private static final AtomicInteger IP = new AtomicInteger(10);

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        String name = PostgresContainerSupport.createDatabaseName("blog_endpoint");
        registry.add("spring.datasource.url", () -> PostgresContainerSupport.jdbcUrlFor(name));
        registry.add("spring.datasource.username", PostgresContainerSupport.POSTGRES::getUsername);
        registry.add("spring.datasource.password", PostgresContainerSupport.POSTGRES::getPassword);
    }

    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate jdbc;
    @Autowired ObjectMapper mapper;

    @BeforeEach
    void setUp() {
        jdbc.execute("TRUNCATE TABLE blog_posts");
    }

    @Test
    void adminPathsNeedTheOpsToken() throws Exception {
        for (MockHttpServletRequestBuilder request : new MockHttpServletRequestBuilder[] {
                get("/v2/admin/blog/posts"),
                post("/v2/admin/blog/posts").contentType(MediaType.APPLICATION_JSON)
                        .content(mapper.writeValueAsString(fields("no-token", "draft"))),
                patch("/v2/admin/blog/posts/" + java.util.UUID.randomUUID()).contentType(MediaType.APPLICATION_JSON).content("{}"),
                multipart("/v2/admin/blog-images").file(new MockMultipartFile("image", "a.png", "image/png", new byte[] {1}))}) {
            assertThat(mvc.perform(request).andReturn().getResponse().getStatus()).isEqualTo(401);
            assertThat(mvc.perform(request.header("Authorization", "Bearer wrong")).andReturn().getResponse().getStatus())
                    .isEqualTo(401);
        }
    }

    @Test
    void createValidatesAndRejectsADuplicateSlug() throws Exception {
        JsonNode created = admin(post("/v2/admin/blog/posts"), body("voice-warmup", "draft"), 201);
        assertThat(created.path("status").textValue()).isEqualTo("draft");
        assertThat(created.path("published_at").isNull()).isTrue();
        assertThat(created.path("author_name").textValue()).isEqualTo("액터브 팀");
        assertThat(created.path("reading_minutes").intValue()).isEqualTo(1);

        JsonNode duplicate = admin(post("/v2/admin/blog/posts"), body("voice-warmup", "draft"), 409);
        assertThat(duplicate.path("detail").textValue()).isEqualTo("slug_taken");

        Map<String, Object> badSlug = fields("Bad Slug", "draft");
        JsonNode invalid = admin(post("/v2/admin/blog/posts"), badSlug, 422);
        assertThat(invalid.path("detail").get(0).path("loc").toString()).isEqualTo("[\"body\",\"slug\"]");
        Map<String, Object> missing = fields("no-category", "draft");
        missing.remove("category");
        admin(post("/v2/admin/blog/posts"), missing, 422);
    }

    @Test
    void publishedPostsAreReadableWithoutLoginOrClientHeaderAndDraftsAreHidden() throws Exception {
        admin(post("/v2/admin/blog/posts"), body("draft-one", "draft"), 201);
        JsonNode live = admin(post("/v2/admin/blog/posts"), body("live-one", "published"), 201);
        assertThat(live.path("published_at").isTextual()).isTrue();

        JsonNode list = publicGet("/v2/blog/posts", 200);
        assertThat(list.path("items")).hasSize(1);
        JsonNode item = list.path("items").get(0);
        assertThat(item.fieldNames()).toIterable().containsExactlyInAnyOrder("slug", "title", "summary", "category",
                "cover_image_url", "published_at", "reading_minutes");
        assertThat(item.path("slug").textValue()).isEqualTo("live-one");

        assertThat(publicGet("/v2/blog/posts?category=news", 200).path("items")).isEmpty();
        assertThat(publicGet("/v2/blog/posts?category=bogus", 422).path("detail")).isNotEmpty();
        assertThat(publicGet("/v2/blog/posts?limit=0", 422).path("detail")).isNotEmpty();

        JsonNode detail = publicGet("/v2/blog/posts/live-one", 200);
        assertThat(detail.path("body_markdown").textValue()).contains("본문");
        assertThat(detail.path("app_cta").textValue()).isEqualTo("coaching");
        assertThat(detail.path("author_name").textValue()).isEqualTo("액터브 팀");
        assertThat(publicGet("/v2/blog/posts/draft-one", 404).path("detail").textValue()).isEqualTo("post_not_found");
        assertThat(publicGet("/v2/blog/posts/missing", 404).path("detail").textValue()).isEqualTo("post_not_found");
    }

    @Test
    void anExpiredTokenDoesNotBlockPublicReads() throws Exception {
        MockHttpServletResponse response = mvc.perform(get("/v2/blog/posts").header("Authorization", "Bearer expired")
                .header("X-Forwarded-For", "198.51.100." + IP.getAndIncrement())).andReturn().getResponse();
        assertThat(response.getStatus()).isEqualTo(200);
    }

    @Test
    void patchPublishesOnceAndKeepsTheFirstPublishedAt() throws Exception {
        String id = admin(post("/v2/admin/blog/posts"), body("later", "draft"), 201).path("id").textValue();

        JsonNode published = admin(patch("/v2/admin/blog/posts/" + id), Map.of("status", "published"), 200);
        String first = published.path("published_at").textValue();
        assertThat(first).isNotNull();

        JsonNode down = admin(patch("/v2/admin/blog/posts/" + id), Map.of("status", "draft", "title", "새 제목"), 200);
        assertThat(down.path("title").textValue()).isEqualTo("새 제목");
        assertThat(down.path("published_at").textValue()).isEqualTo(first);
        assertThat(publicGet("/v2/blog/posts/later", 404).path("detail").textValue()).isEqualTo("post_not_found");

        JsonNode backdated = admin(patch("/v2/admin/blog/posts/" + id), Map.of("published_at", "2026-01-01T00:00:00Z"), 200);
        assertThat(backdated.path("published_at").textValue()).startsWith("2026-01-01T00:00:00");
        assertThat(admin(patch("/v2/admin/blog/posts/" + id), Map.of("bogus", 1), 422)
                .path("detail").get(0).path("type").textValue()).isEqualTo("extra_forbidden");
        assertThat(admin(patch("/v2/admin/blog/posts/" + id), Map.of("category", "nope"), 422)
                .path("detail").get(0).path("loc").toString()).isEqualTo("[\"body\",\"category\"]");
        assertThat(admin(patch("/v2/admin/blog/posts/" + java.util.UUID.randomUUID()), Map.of("title", "x"), 404)
                .path("detail").textValue()).isEqualTo("post_not_found");

        admin(post("/v2/admin/blog/posts"), body("other", "draft"), 201);
        assertThat(admin(patch("/v2/admin/blog/posts/" + id), Map.of("slug", "other"), 409)
                .path("detail").textValue()).isEqualTo("slug_taken");
        assertThat(mapper.readTree(mvc.perform(get("/v2/admin/blog/posts").header("Authorization", ADMIN))
                .andReturn().getResponse().getContentAsString()).path("items")).hasSize(2);
    }

    @Test
    void imageUploadChecksTypeAndSizeAndThePublicUrlRedirects() throws Exception {
        MockHttpServletResponse ok = mvc.perform(multipart("/v2/admin/blog-images")
                .file(new MockMultipartFile("image", "a.png", "image/png", new byte[] {1, 2, 3})).header("Authorization", ADMIN)).andReturn().getResponse();
        assertThat(ok.getStatus()).isEqualTo(200);
        String url = mapper.readTree(ok.getContentAsString()).path("url").textValue();
        assertThat(url).startsWith("/v2/blog/images/").endsWith(".png");

        MockHttpServletResponse redirect = mvc.perform(get(url)).andReturn().getResponse();
        assertThat(redirect.getStatus()).isEqualTo(302);
        assertThat(redirect.getHeader("Location")).startsWith("https://signed.example/blog/");
        assertThat(mvc.perform(get("/v2/blog/images/nope.png")).andReturn().getResponse().getStatus()).isEqualTo(404);

        assertThat(mvc.perform(multipart("/v2/admin/blog-images")
                .file(new MockMultipartFile("image", "a.gif", "image/gif", new byte[] {1})).header("Authorization", ADMIN)).andReturn().getResponse()
                .getStatus()).isEqualTo(415);
        assertThat(mvc.perform(multipart("/v2/admin/blog-images")
                .file(new MockMultipartFile("image", "a.png", "image/png", new byte[2 * 1024 * 1024 + 1])).header("Authorization", ADMIN)).andReturn()
                .getResponse().getStatus()).isEqualTo(413);
    }

    // ─── helpers ────────────────────────────────────────────────────────

    private static Map<String, Object> fields(String slug, String status) {
        Map<String, Object> fields = new LinkedHashMap<>();
        fields.put("slug", slug);
        fields.put("title", "목소리 풀기");
        fields.put("summary", "연습 전에 목을 푸는 방법");
        fields.put("category", "practice");
        fields.put("body_markdown", "## 본문\n\n천천히 시작해요.");
        fields.put("app_cta", "coaching");
        fields.put("status", status);
        return fields;
    }

    private static Map<String, Object> body(String slug, String status) {
        return fields(slug, status);
    }

    private JsonNode admin(MockHttpServletRequestBuilder request, Map<String, Object> payload, int status) throws Exception {
        MockHttpServletResponse response = mvc.perform(request.header("Authorization", ADMIN)
                .contentType(MediaType.APPLICATION_JSON).content(mapper.writeValueAsString(payload))).andReturn().getResponse();
        assertThat(response.getStatus()).as(response.getContentAsString()).isEqualTo(status);
        return mapper.readTree(response.getContentAsString());
    }

    private JsonNode publicGet(String path, int status) throws Exception {
        MockHttpServletResponse response = mvc.perform(get(path).header("X-Forwarded-For", "198.51.100." + IP.getAndIncrement()))
                .andReturn().getResponse();
        assertThat(response.getStatus()).as(response.getContentAsString()).isEqualTo(status);
        return mapper.readTree(response.getContentAsString());
    }

    @TestConfiguration
    static class StorageFixture {
        @Bean
        @Primary
        ObjectStorage blogStorage() {
            Map<String, byte[]> stored = new LinkedHashMap<>();
            return new ObjectStorage() {
                @Override public String presignUpload(String k, String m, long s, int e) { return "put:" + k; }
                @Override public String presignPlayback(String k, int e) {
                    return stored.containsKey(k) ? "https://signed.example/" + k : null;
                }
                @Override public StoredObjectMetadata head(String k) { return null; }
                @Override public StoredObjectMetadata downloadToPath(String k, Path d) { return null; }
                @Override public void upload(String k, String m, Path s) { }
                @Override public void upload(String k, String m, byte[] c) { stored.put(k, c); }
                @Override public void delete(String k) { stored.remove(k); }
            };
        }
    }
}
