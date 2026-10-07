package com.acttub.actingapi.feature.poster;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import java.nio.file.Path;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.auth.app.JwtService;
import com.acttub.actingapi.integration.storage.ObjectStorage;
import com.acttub.actingapi.integration.storage.StoredObjectMetadata;
import com.acttub.actingapi.support.AccountFixtures;
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
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

/** app.poster — 앱이 받는 포스터 고르기와 운영 토큰으로 여는 관리 경로. */
@SpringBootTest(properties = {"JWT_SECRET=test-secret", "ADMIN_OPS_TOKEN=admin-secret",
        "ACCOUNT_CLEANUP_ENABLED=false", "ACCOUNT_HOUSEKEEPING_ENABLED=false"})
@AutoConfigureMockMvc
@Import(PosterEndpointIT.StorageFixture.class)
class PosterEndpointIT {
    private static final String ADMIN = "Bearer admin-secret";

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        String name = PostgresContainerSupport.createDatabaseName("poster_endpoint");
        registry.add("spring.datasource.url", () -> PostgresContainerSupport.jdbcUrlFor(name));
        registry.add("spring.datasource.username", PostgresContainerSupport.POSTGRES::getUsername);
        registry.add("spring.datasource.password", PostgresContainerSupport.POSTGRES::getPassword);
    }

    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate jdbc;
    @Autowired JwtService jwt;
    @Autowired ObjectMapper mapper;
    String bearer;
    OffsetDateTime now;

    @BeforeEach
    void setUp() {
        jdbc.execute("TRUNCATE TABLE users,consent_documents,app_posters RESTART IDENTITY CASCADE");
        for (String type : List.of("terms", "privacy", "ai_analysis", "retention")) {
            jdbc.update("""
                    INSERT INTO consent_documents(id,type,version,locale,title,body,required,published_at)
                    VALUES (?,?,'v1','ko',?,?,?,?)
                    """, UUID.randomUUID(), type, type, type, !"retention".equals(type),
                    OffsetDateTime.of(2026, 9, 1, 0, 0, 0, 0, ZoneOffset.UTC));
        }
        UUID user = UUID.randomUUID();
        jdbc.update("INSERT INTO users(id,status) VALUES (?,'active')", user);
        AccountFixtures.passGate(jdbc, user);
        bearer = "Bearer " + jwt.issueAccessToken(user).value();
        now = OffsetDateTime.now(ZoneOffset.UTC);
    }

    // ─── 앱 ─────────────────────────────────────────────────────────────

    @Test
    void appListRequiresALoggedInUser() throws Exception {
        assertThat(mvc.perform(get("/v2/app/posters").param("platform", "ios")).andReturn().getResponse().getStatus())
                .isEqualTo(401);
    }

    @Test
    void appListRejectsMissingOrInvalidQueriesWithTheValidationShape() throws Exception {
        JsonNode missing = app(get("/v2/app/posters"), 422);
        assertThat(missing.path("detail").get(0).path("type").textValue()).isEqualTo("missing");
        assertThat(missing.path("detail").get(0).path("loc").toString()).isEqualTo("[\"query\",\"platform\"]");
        for (String[] bad : List.of(new String[] {"platform", "web"}, new String[] {"locale", "korean"},
                new String[] {"app_version", "0.1.x"})) {
            var request = "platform".equals(bad[0]) ? get("/v2/app/posters").param("platform", bad[1])
                    : get("/v2/app/posters").param("platform", "ios").param(bad[0], bad[1]);
            JsonNode body = app(request, 422);
            assertThat(body.path("detail").get(0).path("loc").toString()).isEqualTo("[\"query\",\"" + bad[0] + "\"]");
            assertThat(body.path("detail").get(0).path("type").textValue()).isEqualTo("value_error");
        }
    }

    @Test
    void appListPicksActivePostersInTheirPeriodForThePlatformAndLanguageByPriority() throws Exception {
        insert("low", 1, true, null, null, "{ios,android}", null, null);
        insert("high", 9, true, now.minusDays(1), now.plusDays(1), "{ios}", "ko", null);
        insert("off", 50, false, null, null, "{ios,android}", null, null);
        insert("ended", 50, true, now.minusDays(2), now.minusSeconds(1), "{ios,android}", null, null);
        insert("upcoming", 50, true, now.plusMinutes(5), null, "{ios,android}", null, null);
        insert("android-only", 50, true, null, null, "{android}", null, null);
        insert("english", 40, true, null, null, "{ios,android}", "en", null);
        insert("needs-new", 5, true, null, null, "{ios,android}", null, "0.1.10");

        assertThat(slugs(app(appList("ios", "ko", "0.1.9"), 200))).containsExactly("high", "low");
        assertThat(slugs(app(appList("ios", "ko", "0.1.10"), 200))).containsExactly("high", "needs-new", "low");
        assertThat(slugs(app(appList("ios", "ko", null), 200))).containsExactly("high", "low");
        assertThat(slugs(app(appList("ios", null, "0.1.9"), 200))).containsExactly("low");
        assertThat(slugs(app(appList("android", "en", "1.0.0"), 200)))
                .containsExactly("android-only", "english", "needs-new", "low");
    }

    @Test
    void appListBreaksPriorityTiesByLatestUpdateAndKeepsAtMostFive() throws Exception {
        for (int index = 0; index < 7; index++) {
            insert("same-" + index, 3, true, null, null, "{ios,android}", null, null);
            jdbc.update("UPDATE app_posters SET updated_at=? WHERE slug=?", now.minusMinutes(10 - index), "same-" + index);
        }
        assertThat(slugs(app(appList("ios", "ko", "0.1.3"), 200)))
                .containsExactly("same-6", "same-5", "same-4", "same-3", "same-2");
    }

    @Test
    void appListShowsTheContractShapeAndSignsStoredImages() throws Exception {
        String key = "posters/" + UUID.randomUUID() + ".png";
        insert("stored", 2, true, null, null, "{ios,android}", null, null);
        jdbc.update("""
                UPDATE app_posters SET image=?,audio=?,badge='배지',body='본문',cta_label='보기',cta_action='route',
                       cta_target='/reading',frequency='once',dismissible=false,revision=3 WHERE slug='stored'
                """, key, "posters/" + UUID.randomUUID() + ".png");
        insert("bundled", 1, true, null, null, "{ios,android}", null, null);
        jdbc.update("UPDATE app_posters SET image='asset:mascot-reading',audio='asset:cloud-voice-sample',"
                + "audience='cloud_voice_off' WHERE slug='bundled'");

        JsonNode posters = app(appList("ios", "ko", "0.1.3"), 200).path("posters");
        JsonNode stored = posters.get(0);
        assertThat(stored.fieldNames()).toIterable().containsExactly("slug", "revision", "frequency", "audience",
                "dismissible", "badge", "title", "body", "image_url", "image_asset", "audio_asset", "cta_label",
                "cta_action", "cta_target");
        assertThat(stored.path("revision").intValue()).isEqualTo(3);
        assertThat(stored.path("frequency").textValue()).isEqualTo("once");
        assertThat(stored.path("dismissible").booleanValue()).isFalse();
        assertThat(stored.path("image_url").textValue()).isEqualTo("signed:" + key + ":3600");
        assertThat(stored.path("image_asset").isNull()).isTrue();
        assertThat(stored.path("audio_asset").isNull()).as("오디오는 앱 번들 자산만 낸다").isTrue();
        assertThat(stored.path("cta_action").textValue()).isEqualTo("route");
        assertThat(stored.path("cta_target").textValue()).isEqualTo("/reading");

        JsonNode bundled = posters.get(1);
        assertThat(bundled.path("image_url").isNull()).isTrue();
        assertThat(bundled.path("image_asset").textValue()).isEqualTo("mascot-reading");
        assertThat(bundled.path("audio_asset").textValue()).isEqualTo("cloud-voice-sample");
        assertThat(bundled.path("audience").textValue()).isEqualTo("cloud_voice_off");
        assertThat(bundled.path("badge").isNull()).isTrue();
        assertThat(bundled.path("cta_label").isNull()).isTrue();
        assertThat(bundled.path("cta_action").textValue()).isEqualTo("none");
    }

    @Test
    void appListStillAnswersWhenAnImageCannotBeSigned() throws Exception {
        insert("broken", 2, true, null, null, "{ios,android}", null, null);
        jdbc.update("UPDATE app_posters SET image=? WHERE slug='broken'",
                "posters/00000000-0000-4000-8000-00000000fa11.png");
        JsonNode poster = app(appList("ios", "ko", "0.1.3"), 200).path("posters").get(0);
        assertThat(poster.path("image_url").isNull()).isTrue();
        assertThat(poster.path("image_asset").isNull()).isTrue();
    }

    // ─── 관리 ───────────────────────────────────────────────────────────

    @Test
    void adminRoutesRejectMissingOrWrongTokens() throws Exception {
        UUID id = UUID.randomUUID();
        List<java.util.function.Supplier<MockHttpServletRequestBuilder>> requests = List.of(
                () -> get("/v2/admin/posters"),
                () -> post("/v2/admin/posters").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"slug\":\"a\",\"title\":\"t\"}"),
                () -> patch("/v2/admin/posters/" + id).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"title\":\"t\"}"),
                () -> post("/v2/admin/poster-images").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"content_type\":\"image/png\",\"size_bytes\":10}"));
        JsonNode unauthorized = mapper.readTree("{\"detail\":\"Unauthorized\"}");
        for (var request : requests) {
            assertThat(json(request.get(), 401)).isEqualTo(unauthorized);
            assertThat(json(request.get().header("Authorization", "Bearer nope"), 401)).isEqualTo(unauthorized);
            assertThat(json(request.get().header("Authorization", bearer), 401))
                    .as("사용자 토큰으로는 열리지 않는다")
                    .isEqualTo(unauthorized);
        }
        assertThat(jdbc.queryForObject("SELECT count(*) FROM app_posters", Integer.class)).isZero();
    }

    @Test
    void adminCreatesWithDefaultsAndListsEverythingIncludingInactive() throws Exception {
        JsonNode created = json(admin(post("/v2/admin/posters"), """
                {"slug":"summer","title":"여름 공지","locale":"ko","ends_at":"2026-12-01T00:00:00+09:00"}
                """), 201);
        assertThat(created.fieldNames()).toIterable().containsExactly("id", "slug", "revision", "active", "priority",
                "starts_at", "ends_at", "platforms", "locale", "min_app_version", "frequency", "audience",
                "dismissible", "badge", "title", "body", "image", "audio", "cta_label", "cta_action", "cta_target",
                "created_at", "updated_at");
        assertThat(created.path("revision").intValue()).isEqualTo(1);
        assertThat(created.path("active").booleanValue()).isFalse();
        assertThat(created.path("platforms").toString()).isEqualTo("[\"ios\",\"android\"]");
        assertThat(created.path("frequency").textValue()).isEqualTo("daily");
        assertThat(created.path("audience").textValue()).isEqualTo("all");
        assertThat(created.path("cta_action").textValue()).isEqualTo("none");
        assertThat(created.path("ends_at").textValue()).isEqualTo("2026-11-30T15:00:00.000000Z");
        assertThat(created.path("starts_at").isNull()).isTrue();

        JsonNode listed = json(admin(get("/v2/admin/posters"), null), 200);
        assertThat(listed.path("posters")).hasSize(1);
        assertThat(listed.path("posters").get(0)).isEqualTo(created);
        assertThat(slugs(app(appList("ios", "ko", "0.1.3"), 200))).as("꺼진 채로 만들어진다").isEmpty();
    }

    @Test
    void adminCreateRejectsDuplicatesBrokenRulesAndUnknownKeys() throws Exception {
        json(admin(post("/v2/admin/posters"), "{\"slug\":\"dup\",\"title\":\"t\",\"locale\":\"ko\"}"), 201);
        assertThat(json(admin(post("/v2/admin/posters"), "{\"slug\":\"dup\",\"title\":\"t2\",\"locale\":\"ko\"}"), 422))
                .isEqualTo(mapper.readTree("{\"detail\":\"duplicate_poster\"}"));
        json(admin(post("/v2/admin/posters"), "{\"slug\":\"dup\",\"title\":\"t3\",\"locale\":\"en\"}"), 201);

        JsonNode badTarget = json(admin(post("/v2/admin/posters"),
                "{\"slug\":\"u\",\"title\":\"t\",\"cta_action\":\"url\",\"cta_target\":\"http://acttub.com\"}"), 422);
        assertThat(badTarget.path("detail").get(0).path("loc").toString()).isEqualTo("[\"body\",\"cta_target\"]");
        JsonNode missingTitle = json(admin(post("/v2/admin/posters"), "{\"slug\":\"u\"}"), 422);
        assertThat(missingTitle.path("detail").get(0).path("loc").toString()).isEqualTo("[\"body\",\"title\"]");
        JsonNode unknown = json(admin(post("/v2/admin/posters"), "{\"slug\":\"u\",\"title\":\"t\",\"color\":\"red\"}"), 422);
        assertThat(unknown.path("detail").isArray()).isTrue();
        JsonNode badTime = json(admin(post("/v2/admin/posters"), "{\"slug\":\"u\",\"title\":\"t\",\"starts_at\":\"내일\"}"), 422);
        assertThat(badTime.path("detail").get(0).path("loc").toString()).isEqualTo("[\"body\",\"starts_at\"]");
        assertThat(jdbc.queryForObject("SELECT count(*) FROM app_posters", Integer.class)).isEqualTo(2);
    }

    @Test
    void adminPatchChangesOnlySentFieldsAndBumpsRevisionOnRequest() throws Exception {
        JsonNode created = json(admin(post("/v2/admin/posters"), """
                {"slug":"p","title":"원래","body":"본문","ends_at":"2026-12-01T00:00:00Z","priority":4}
                """), 201);
        String id = created.path("id").textValue();
        jdbc.update("UPDATE app_posters SET updated_at=updated_at - interval '1 minute' WHERE id=?::uuid", id);

        JsonNode patched = json(admin(patch("/v2/admin/posters/" + id),
                "{\"title\":\"바뀜\",\"ends_at\":null,\"active\":true}"), 200);
        assertThat(patched.path("title").textValue()).isEqualTo("바뀜");
        assertThat(patched.path("ends_at").isNull()).isTrue();
        assertThat(patched.path("active").booleanValue()).isTrue();
        assertThat(patched.path("body").textValue()).isEqualTo("본문");
        assertThat(patched.path("priority").intValue()).isEqualTo(4);
        assertThat(patched.path("revision").intValue()).isEqualTo(1);
        assertThat(patched.path("updated_at").textValue()).isGreaterThan(created.path("updated_at").textValue());
        assertThat(patched.path("created_at")).isEqualTo(created.path("created_at"));

        JsonNode bumped = json(admin(patch("/v2/admin/posters/" + id), "{\"bump_revision\":true}"), 200);
        assertThat(bumped.path("revision").intValue()).isEqualTo(2);
        assertThat(bumped.path("title").textValue()).isEqualTo("바뀜");

        JsonNode off = json(admin(patch("/v2/admin/posters/" + id), "{\"active\":false}"), 200);
        assertThat(off.path("active").booleanValue()).isFalse();
        assertThat(off.path("revision").intValue()).isEqualTo(2);
    }

    @Test
    void adminPatchRejectsUnknownPostersBrokenRulesAndCollisions() throws Exception {
        assertThat(json(admin(patch("/v2/admin/posters/" + UUID.randomUUID()), "{\"title\":\"t\"}"), 404))
                .isEqualTo(mapper.readTree("{\"detail\":\"poster_not_found\"}"));
        String id = json(admin(post("/v2/admin/posters"), "{\"slug\":\"a\",\"title\":\"t\"}"), 201).path("id").textValue();
        json(admin(post("/v2/admin/posters"), "{\"slug\":\"b\",\"title\":\"t\"}"), 201);

        assertThat(json(admin(patch("/v2/admin/posters/" + id), "{\"slug\":\"b\"}"), 422))
                .isEqualTo(mapper.readTree("{\"detail\":\"duplicate_poster\"}"));
        JsonNode broken = json(admin(patch("/v2/admin/posters/" + id), "{\"cta_action\":\"route\"}"), 422);
        assertThat(broken.path("detail").get(0).path("loc").toString()).isEqualTo("[\"body\",\"cta_target\"]");
        JsonNode unknown = json(admin(patch("/v2/admin/posters/" + id), "{\"revision\":9}"), 422);
        assertThat(unknown.path("detail").get(0).path("type").textValue()).isEqualTo("extra_forbidden");
        JsonNode wrongType = json(admin(patch("/v2/admin/posters/" + id), "{\"priority\":\"high\"}"), 422);
        assertThat(wrongType.path("detail").get(0).path("loc").toString()).isEqualTo("[\"body\",\"priority\"]");
        assertThat(jdbc.queryForObject("SELECT slug FROM app_posters WHERE id=?::uuid", String.class, id)).isEqualTo("a");
    }

    @Test
    void adminImageUploadReturnsAPosterKeyAndATenMinuteUploadUrl() throws Exception {
        JsonNode upload = json(admin(post("/v2/admin/poster-images"),
                "{\"content_type\":\"image/webp\",\"size_bytes\":2048}"), 200);
        assertThat(upload.fieldNames()).toIterable().containsExactly("key", "upload_url", "expires_in");
        String key = upload.path("key").textValue();
        assertThat(key).matches("posters/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.webp");
        assertThat(upload.path("upload_url").textValue()).isEqualTo("put:" + key + ":image/webp:2048:600");
        assertThat(upload.path("expires_in").intValue()).isEqualTo(600);

        assertThat(json(admin(post("/v2/admin/poster-images"), "{\"content_type\":\"image/gif\",\"size_bytes\":10}"), 415))
                .isEqualTo(mapper.readTree("{\"detail\":\"unsupported_media_type\"}"));
        assertThat(json(admin(post("/v2/admin/poster-images"),
                "{\"content_type\":\"image/png\",\"size_bytes\":10485761}"), 413))
                .isEqualTo(mapper.readTree("{\"detail\":\"upload_too_large\"}"));

        String created = json(admin(post("/v2/admin/posters"),
                "{\"slug\":\"img\",\"title\":\"t\",\"active\":true,\"image\":\"" + key + "\"}"), 201).path("image").textValue();
        assertThat(created).isEqualTo(key);
        assertThat(app(appList("ios", "ko", "0.1.3"), 200).path("posters").get(0).path("image_url").textValue())
                .isEqualTo("signed:" + key + ":3600");
    }

    // ─── 도움 ───────────────────────────────────────────────────────────

    private void insert(String slug, int priority, boolean active, OffsetDateTime startsAt, OffsetDateTime endsAt,
            String platforms, String locale, String minAppVersion) {
        jdbc.update("""
                INSERT INTO app_posters(slug,priority,active,starts_at,ends_at,platforms,locale,min_app_version,title)
                VALUES (?,?,?,?,?,?::text[],?,?,?)
                """, slug, priority, active, startsAt, endsAt, platforms, locale, minAppVersion, slug + " 제목");
    }

    private MockHttpServletRequestBuilder appList(String platform, String locale, String appVersion) {
        var request = get("/v2/app/posters").param("platform", platform);
        if (locale != null) request = request.param("locale", locale);
        if (appVersion != null) request = request.param("app_version", appVersion);
        return request;
    }

    private JsonNode app(MockHttpServletRequestBuilder request, int status) throws Exception {
        return json(request.header("Authorization", bearer), status);
    }

    private MockHttpServletRequestBuilder admin(MockHttpServletRequestBuilder request, String body) {
        request = request.header("Authorization", ADMIN);
        return body == null ? request : request.contentType(MediaType.APPLICATION_JSON).content(body);
    }

    private JsonNode json(MockHttpServletRequestBuilder request, int status) throws Exception {
        var response = mvc.perform(request).andReturn().getResponse();
        assertThat(response.getStatus()).as(response.getContentAsString()).isEqualTo(status);
        return mapper.readTree(response.getContentAsString());
    }

    private static List<String> slugs(JsonNode body) {
        List<String> slugs = new ArrayList<>();
        body.path("posters").forEach(poster -> slugs.add(poster.path("slug").textValue()));
        return slugs;
    }

    @TestConfiguration(proxyBeanMethods = false)
    static class StorageFixture {
        @Bean
        @Primary
        ObjectStorage posterStorage() {
            return new ObjectStorage() {
                @Override
                public String presignUpload(String objectKey, String mimeType, long sizeBytes, int expiresInSeconds) {
                    return "put:" + objectKey + ":" + mimeType + ":" + sizeBytes + ":" + expiresInSeconds;
                }

                @Override
                public String presignPlayback(String objectKey, int expiresInSeconds) {
                    if (objectKey.contains("fa11")) throw new RuntimeException("fixture signing failure");
                    return "signed:" + objectKey + ":" + expiresInSeconds;
                }

                @Override public StoredObjectMetadata head(String objectKey) { return null; }
                @Override public StoredObjectMetadata downloadToPath(String objectKey, Path destination) { return null; }
                @Override public void upload(String objectKey, String mimeType, Path source) { }
                @Override public void delete(String objectKey) { }
            };
        }
    }
}
