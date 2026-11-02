package com.acttub.actingapi.feature.community;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

import com.acttub.actingapi.feature.auth.app.JwtService;
import com.acttub.actingapi.feature.community.app.CommunityImageService;
import com.acttub.actingapi.integration.storage.ObjectStorage;
import com.acttub.actingapi.integration.storage.StoredObjectMetadata;
import com.acttub.actingapi.support.AccountFixtures;
import com.acttub.actingapi.support.MutableClock;
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
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

/**
 * 게시판 글 사진(SOMA-873). 포트폴리오 사진과 같은 올리기 길이와, 글에 붙이고 떼고 지우는 규칙을 본다. 저장소는 메모리
 * 가짜이고 "올렸다"는 그 가짜에 객체를 넣는 것이다.
 */
@SpringBootTest(properties = {
    "JWT_SECRET=test-secret",
    "ACCOUNT_CLEANUP_ENABLED=false",
    "ACCOUNT_HOUSEKEEPING_ENABLED=false",
    "COMMUNITY_IMAGE_SWEEP_ENABLED=false"
})
@AutoConfigureMockMvc
@Import({MutableClock.Fixture.class, CommunityImageIT.StorageFixture.class})
class CommunityImageIT {

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        String name = PostgresContainerSupport.createDatabaseName("community_image");
        registry.add("spring.datasource.url", () -> PostgresContainerSupport.jdbcUrlFor(name));
        registry.add("spring.datasource.username", PostgresContainerSupport.POSTGRES::getUsername);
        registry.add("spring.datasource.password", PostgresContainerSupport.POSTGRES::getPassword);
    }

    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate jdbc;
    @Autowired ObjectMapper mapper;
    @Autowired JwtService jwt;
    @Autowired MutableClock clock;
    @Autowired FakeStorage storage;
    @Autowired CommunityImageService images;

    UUID me;
    UUID other;

    @BeforeEach
    void setUp() {
        jdbc.execute("TRUNCATE TABLE users RESTART IDENTITY CASCADE");
        storage.objects.clear();
        clock.set(Instant.now().truncatedTo(ChronoUnit.SECONDS));
        me = member("나");
        other = member("다른 배우");
    }

    @Test
    void uploadFollowsThePortfolioPhotoPathUnderCommunityKeys() throws Exception {
        JsonNode upload = json(post("/v2/community/images"), me,
                "{\"mime_type\":\"image/jpeg\",\"size_bytes\":1000}", 201);
        UUID imageId = UUID.fromString(upload.path("image_id").textValue());
        String objectKey = objectKey(imageId);
        assertThat(objectKey).startsWith("community/" + me + "/").endsWith(".jpg");
        assertThat(upload.path("upload_url").textValue()).isEqualTo("https://storage.test/put/" + objectKey);
        assertThat(upload.path("upload_headers").path("Content-Type").textValue()).isEqualTo("image/jpeg");
        assertThat(Instant.parse(upload.path("expires_at").textValue())).isEqualTo(clock.instant().plus(Duration.ofMinutes(30)));

        assertThat(detail(post("/v2/community/images"), me, "{\"mime_type\":\"image/gif\",\"size_bytes\":10}", 415))
                .isEqualTo("unsupported_media_type");
        assertThat(detail(post("/v2/community/images"), me,
                "{\"mime_type\":\"image/png\",\"size_bytes\":" + (10L * 1024 * 1024 + 1) + "}", 413))
                .isEqualTo("upload_too_large");

        assertThat(detail(post("/v2/community/images/{id}/complete", imageId), me, null, 409)).isEqualTo("upload_not_found");
        storage.objects.put(objectKey, 999L);
        assertThat(detail(post("/v2/community/images/{id}/complete", imageId), me, null, 409)).isEqualTo("upload_size_mismatch");
        storage.objects.put(objectKey, 1000L);
        JsonNode done = json(post("/v2/community/images/{id}/complete", imageId), me, null, 200);
        assertThat(done.path("id").textValue()).isEqualTo(imageId.toString());
        assertThat(done.path("url").textValue()).isEqualTo("https://storage.test/get/" + objectKey);
        assertThat(detail(post("/v2/community/images/{id}/complete", imageId), other, null, 404))
                .isEqualTo("community_image_not_found");
        UUID late = begin(me);
        clock.advance(Duration.ofMinutes(31));
        assertThat(detail(post("/v2/community/images/{id}/complete", late), me, null, 409)).isEqualTo("upload_intent_expired");
    }

    @Test
    void postsCarryTheirImagesInOrderOnDetailAndList() throws Exception {
        UUID first = uploaded(me);
        UUID second = uploaded(me);
        // 확인 단계를 건너뛴 사진도 올라와 있으면 붙는다.
        UUID unconfirmed = begin(me);
        storage.objects.put(objectKey(unconfirmed), 1000L);

        JsonNode created = json(post("/v2/community/posts"), me, write(List.of(second, first, unconfirmed)), 201);
        assertThat(ids(created.path("images"))).containsExactly(second.toString(), first.toString(), unconfirmed.toString());
        assertThat(created.path("images").get(0).path("url").textValue())
                .isEqualTo("https://storage.test/get/" + objectKey(second));
        String postId = created.path("id").textValue();

        JsonNode seen = json(get("/v2/community/posts/{id}", postId), other, null, 200);
        assertThat(ids(seen.path("images"))).containsExactly(second.toString(), first.toString(), unconfirmed.toString());
        JsonNode listed = json(get("/v2/community/posts"), other, null, 200).path("posts");
        assertThat(ids(listed.get(0).path("images"))).containsExactly(second.toString(), first.toString(), unconfirmed.toString());

        JsonNode plain = json(post("/v2/community/posts"), me,
                "{\"category_slug\":\"free\",\"title\":\"사진 없음\",\"body\":\"본문\"}", 201);
        assertThat(plain.path("images").isArray()).isTrue();
        assertThat(plain.path("images")).isEmpty();
    }

    @Test
    void attachingRejectsTooManyForeignMissingUnuploadedAndAlreadyAttachedImages() throws Exception {
        List<UUID> six = new ArrayList<>();
        for (int i = 0; i < 6; i++) {
            six.add(uploaded(me));
        }
        assertThat(detail(post("/v2/community/posts"), me, write(six), 400)).isEqualTo("too_many_images");
        UUID foreign = uploaded(other);
        assertThat(detail(post("/v2/community/posts"), me, write(List.of(foreign)), 400)).isEqualTo("invalid_image");
        assertThat(detail(post("/v2/community/posts"), me, write(List.of(UUID.randomUUID())), 400)).isEqualTo("invalid_image");
        UUID notUploaded = begin(me);
        assertThat(detail(post("/v2/community/posts"), me, write(List.of(notUploaded)), 400)).isEqualTo("invalid_image");
        UUID once = six.getFirst();
        assertThat(detail(post("/v2/community/posts"), me, write(List.of(once, once)), 400)).isEqualTo("invalid_image");

        json(post("/v2/community/posts"), me, write(List.of(once)), 201);
        assertThat(detail(post("/v2/community/posts"), me, write(List.of(once)), 400)).isEqualTo("invalid_image");
        assertThat(jdbc.queryForObject("SELECT count(*) FROM community_posts", Long.class)).isEqualTo(1L);
    }

    @Test
    void patchReplacesTheImagesAndDeletesWhatWasDropped() throws Exception {
        UUID a = uploaded(me);
        UUID b = uploaded(me);
        UUID c = uploaded(me);
        String postId = json(post("/v2/community/posts"), me, write(List.of(a, b)), 201).path("id").textValue();

        // image_ids 를 빼면 사진은 그대로다.
        JsonNode same = json(patch("/v2/community/posts/{id}", postId), me, "{\"title\":\"고친 제목\",\"body\":\"본문\"}", 200);
        assertThat(ids(same.path("images"))).containsExactly(a.toString(), b.toString());

        String keyA = objectKey(a);
        JsonNode replaced = json(patch("/v2/community/posts/{id}", postId), me,
                "{\"title\":\"고친 제목\",\"body\":\"본문\",\"image_ids\":[\"" + c + "\",\"" + b + "\"]}", 200);
        assertThat(ids(replaced.path("images"))).containsExactly(c.toString(), b.toString());
        assertThat(jdbc.queryForObject("SELECT count(*) FROM community_post_images WHERE id=?", Long.class, a)).isZero();
        assertThat(storage.objects).as("뗀 사진의 객체는 지운다").doesNotContainKey(keyA).containsKey(objectKey(b));

        JsonNode cleared = json(patch("/v2/community/posts/{id}", postId), me,
                "{\"title\":\"고친 제목\",\"body\":\"본문\",\"image_ids\":[]}", 200);
        assertThat(cleared.path("images")).isEmpty();
        assertThat(storage.objects).isEmpty();
    }

    @Test
    void deletingThePostDeletesItsImagesAndHiddenPostsKeepThemFromOthers() throws Exception {
        UUID a = uploaded(me);
        String postId = json(post("/v2/community/posts"), me, write(List.of(a)), 201).path("id").textValue();

        jdbc.update("UPDATE community_posts SET status='hidden' WHERE id=?::uuid", postId);
        assertThat(detail(get("/v2/community/posts/{id}", postId), other, null, 404)).isEqualTo("post_not_found");
        assertThat(ids(json(get("/v2/community/posts/{id}", postId), me, null, 200).path("images")))
                .containsExactly(a.toString());
        jdbc.update("UPDATE community_posts SET status='visible' WHERE id=?::uuid", postId);

        String key = objectKey(a);
        assertThat(perform(delete("/v2/community/posts/{id}", postId), me, null).getStatus()).isEqualTo(204);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM community_post_images", Long.class)).isZero();
        assertThat(storage.objects).doesNotContainKey(key);
    }

    @Test
    void unattachedUploadsAreSweptAfterADayButAttachedOnesStay() throws Exception {
        UUID attached = uploaded(me);
        json(post("/v2/community/posts"), me, write(List.of(attached)), 201);
        UUID loose = uploaded(me);
        String looseKey = objectKey(loose);

        clock.advance(Duration.ofHours(23));
        assertThat(images.sweepUnattached()).isZero();
        clock.advance(Duration.ofHours(2));
        assertThat(images.sweepUnattached()).isEqualTo(1);
        assertThat(jdbc.queryForList("SELECT id FROM community_post_images", UUID.class)).containsExactly(attached);
        assertThat(storage.objects).doesNotContainKey(looseKey).containsKey(objectKey(attached));
    }

    @Test
    void pendingUploadsAreCappedPerPerson() throws Exception {
        for (int i = 0; i < 20; i++) {
            begin(me);
        }
        assertThat(detail(post("/v2/community/images"), me, "{\"mime_type\":\"image/jpeg\",\"size_bytes\":1000}", 429))
                .isEqualTo("too_many_pending_images");
        begin(other);
    }

    // ── helpers ──────────────────────────────────────────────────────────

    private UUID begin(UUID user) throws Exception {
        return UUID.fromString(json(post("/v2/community/images"), user,
                "{\"mime_type\":\"image/jpeg\",\"size_bytes\":1000}", 201).path("image_id").textValue());
    }

    private UUID uploaded(UUID user) throws Exception {
        UUID id = begin(user);
        storage.objects.put(objectKey(id), 1000L);
        json(post("/v2/community/images/{id}/complete", id), user, null, 200);
        return id;
    }

    private String objectKey(UUID imageId) {
        return jdbc.queryForObject("SELECT object_key FROM community_post_images WHERE id=?", String.class, imageId);
    }

    private String write(List<UUID> imageIds) throws Exception {
        return mapper.writeValueAsString(Map.of(
                "category_slug", "free", "title", "사진 글", "body", "본문",
                "image_ids", imageIds.stream().map(UUID::toString).toList()));
    }

    private UUID member(String name) {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO users(id,status) VALUES (?,'active')", id);
        AccountFixtures.passGate(jdbc, id);
        jdbc.update("UPDATE user_profiles SET name=? WHERE user_id=?", name, id);
        return id;
    }

    private MockHttpServletResponse perform(MockHttpServletRequestBuilder request, UUID user, String body) throws Exception {
        request.header("Authorization", "Bearer " + jwt.issueAccessToken(user).value());
        if (body != null) {
            request.contentType(MediaType.APPLICATION_JSON).content(body);
        }
        return mvc.perform(request).andReturn().getResponse();
    }

    private JsonNode json(MockHttpServletRequestBuilder request, UUID user, String body, int status) throws Exception {
        MockHttpServletResponse response = perform(request, user, body);
        assertThat(response.getStatus()).as(response.getContentAsString()).isEqualTo(status);
        return mapper.readTree(response.getContentAsString());
    }

    private String detail(MockHttpServletRequestBuilder request, UUID user, String body, int status) throws Exception {
        return json(request, user, body, status).path("detail").textValue();
    }

    private static List<String> ids(JsonNode array) {
        List<String> values = new ArrayList<>();
        array.forEach(node -> values.add(node.path("id").textValue()));
        return values;
    }

    @TestConfiguration(proxyBeanMethods = false)
    static class StorageFixture {
        @Bean
        @Primary
        FakeStorage fakeStorage() {
            return new FakeStorage();
        }
    }

    /** 메모리의 오브젝트 스토리지. 무엇이 남아 있는지만 안다. */
    static final class FakeStorage implements ObjectStorage {
        final Map<String, Long> objects = new ConcurrentHashMap<>();

        @Override
        public String presignUpload(String objectKey, String mimeType, long sizeBytes, int expiresInSeconds) {
            return "https://storage.test/put/" + objectKey;
        }

        @Override
        public String presignPlayback(String objectKey, int expiresInSeconds) {
            return "https://storage.test/get/" + objectKey;
        }

        @Override
        public StoredObjectMetadata head(String objectKey) {
            Long size = objects.get(objectKey);
            return size == null ? null : new StoredObjectMetadata(size, "image/jpeg", "etag");
        }

        @Override
        public StoredObjectMetadata downloadToPath(String objectKey, Path destination) {
            throw new UnsupportedOperationException();
        }

        @Override
        public void upload(String objectKey, String mimeType, Path source) {
            throw new UnsupportedOperationException();
        }

        @Override
        public void delete(String objectKey) {
            objects.remove(objectKey);
        }
    }
}
