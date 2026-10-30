package com.acttub.actingapi.feature.ads;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import java.nio.file.Path;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import java.util.UUID;
import java.util.function.Supplier;

import com.acttub.actingapi.feature.auth.app.JwtService;
import com.acttub.actingapi.integration.storage.ObjectStorage;
import com.acttub.actingapi.integration.storage.StoredObjectMetadata;
import com.acttub.actingapi.support.AccountFixtures;
import com.acttub.actingapi.support.PostgresContainerSupport;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
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

/** app.ads 운영 경로 — 토큰, 등록·수정·상태, 이미지 올릴 자리, 날짜별 통계, 앱 응답의 서명 이미지·link_url. */
@SpringBootTest(properties = {"JWT_SECRET=test-secret", "ADMIN_OPS_TOKEN=admin-secret", "ACCOUNT_CLEANUP_ENABLED=false",
        "ACCOUNT_HOUSEKEEPING_ENABLED=false", "ADS_PRACTICE_SLOT_PERCENT=0"})
@AutoConfigureMockMvc
@Import(AdAdminEndpointIT.StorageFixture.class)
class AdAdminEndpointIT {
    private static final String ADMIN = "Bearer admin-secret";

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        String name = PostgresContainerSupport.createDatabaseName("ad_admin_endpoint");
        registry.add("spring.datasource.url", () -> PostgresContainerSupport.jdbcUrlFor(name));
        registry.add("spring.datasource.username", PostgresContainerSupport.POSTGRES::getUsername);
        registry.add("spring.datasource.password", PostgresContainerSupport.POSTGRES::getPassword);
    }

    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate jdbc;
    @Autowired JwtService jwt;
    @Autowired ObjectMapper mapper;
    UUID user;
    String bearer;

    @BeforeEach
    void setUp() {
        jdbc.execute("TRUNCATE TABLE users,consent_documents,ads RESTART IDENTITY CASCADE");
        for (String type : List.of("terms", "privacy", "ai_analysis", "retention")) {
            jdbc.update("""
                    INSERT INTO consent_documents(id,type,version,locale,title,body,required,published_at)
                    VALUES (?,?,'v1','ko',?,?,?,?)
                    """, UUID.randomUUID(), type, type, type, !"retention".equals(type),
                    java.time.OffsetDateTime.of(2026, 9, 1, 0, 0, 0, 0, java.time.ZoneOffset.UTC));
        }
        user = UUID.randomUUID();
        jdbc.update("INSERT INTO users(id,status) VALUES (?,'active')", user);
        AccountFixtures.passGate(jdbc, user);
        bearer = "Bearer " + jwt.issueAccessToken(user).value();
    }

    @Test
    @DisplayName("토큰이 없거나 틀리거나 사용자 토큰이면 모든 운영 경로가 401")
    void requiresAdminToken() throws Exception {
        UUID id = UUID.randomUUID();
        List<Supplier<MockHttpServletRequestBuilder>> requests = List.of(
                () -> get("/v2/admin/ads"),
                () -> post("/v2/admin/ads").contentType(MediaType.APPLICATION_JSON).content("{}"),
                () -> patch("/v2/admin/ads/" + id).contentType(MediaType.APPLICATION_JSON).content("{}"),
                () -> get("/v2/admin/ads/" + id + "/stats"),
                () -> post("/v2/admin/ad-images").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"size\":\"BANNER\",\"width\":320,\"height\":50,\"content_type\":\"image/png\",\"size_bytes\":10}"));
        JsonNode unauthorized = mapper.readTree("{\"detail\":\"Unauthorized\"}");
        for (var request : requests) {
            assertThat(json(request.get(), 401)).isEqualTo(unauthorized);
            assertThat(json(request.get().header("Authorization", "Bearer nope"), 401)).isEqualTo(unauthorized);
            assertThat(json(request.get().header("Authorization", bearer), 401)).isEqualTo(unauthorized);
        }
        assertThat(jdbc.queryForObject("SELECT count(*) FROM ads", Integer.class)).isZero();
    }

    @Test
    @DisplayName("이미지 올릴 자리는 규격 폴더 키와 10분 주소, 크기·형식·용량이 틀리면 422·415·413")
    void imageUpload() throws Exception {
        JsonNode upload = json(admin(post("/v2/admin/ad-images"), request("BANNER", 640, 100, "image/webp", 2048)), 200);
        String key = upload.path("key").textValue();
        assertThat(key).matches("ads/banner/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.webp");
        assertThat(upload.path("upload_url").textValue()).isEqualTo("put:" + key + ":image/webp:2048:600");
        assertThat(upload.path("expires_in").intValue()).isEqualTo(600);

        json(admin(post("/v2/admin/ad-images"), request("BANNER", 300, 250, "image/png", 10)), 422);
        json(admin(post("/v2/admin/ad-images"), request("HUGE", 320, 50, "image/png", 10)), 422);
        json(admin(post("/v2/admin/ad-images"), request("BANNER", 320, 50, "image/gif", 10)), 415);
        json(admin(post("/v2/admin/ad-images"), request("BANNER", 320, 50, "image/png", 2 * 1024 * 1024 + 1)), 413);
    }

    @Test
    @DisplayName("직접 광고 등록 규칙, 수정·상태 전환, 목록 합계, 날짜별 통계, 앱 응답의 서명 이미지와 link_url")
    void lifecycle() throws Exception {
        String key = json(admin(post("/v2/admin/ad-images"), request("BANNER", 320, 50, "image/png", 100)), 200)
                .path("key").textValue();

        // link_url 없음·이미지 없음·학원 전용 칸 없이도 되는 정상 등록
        JsonNode noLink = json(admin(post("/v2/admin/ads"),
                "{\"kind\":\"direct\",\"advertiser_name\":\"한빛연기학원\",\"slots\":[\"home_top\"],\"image_banner\":\"" + key + "\"}"), 422);
        assertThat(noLink.path("detail").get(0).path("loc").toString()).isEqualTo("[\"body\",\"link_url\"]");
        JsonNode noImage = json(admin(post("/v2/admin/ads"),
                "{\"kind\":\"direct\",\"advertiser_name\":\"한빛\",\"slots\":[\"home_top\"],\"link_url\":\"https://example.com\"}"), 422);
        assertThat(noImage.path("detail").get(0).path("loc").toString()).isEqualTo("[\"body\",\"image_banner\"]");
        JsonNode extra = json(admin(post("/v2/admin/ads"), "{\"tuition\":\"월 40만원\"}"), 422);
        assertThat(extra.path("detail").get(0).path("type").textValue()).isEqualTo("extra_forbidden");

        JsonNode created = json(admin(post("/v2/admin/ads"), "{\"kind\":\"direct\",\"advertiser_name\":\"한빛연기학원\","
                + "\"slots\":[\"home_top\"],\"image_banner\":\"" + key + "\",\"link_url\":\"https://example.com/a\","
                + "\"priority\":5}"), 201);
        String id = created.path("id").textValue();
        assertThat(created.path("status").textValue()).isEqualTo("active");
        assertThat(created.path("image_banner_url").textValue()).isEqualTo("signed:" + key + ":3600");
        assertThat(created.path("impressions").longValue()).isZero();

        // 앱은 서명 주소와 link_url 을 받는다
        finishReading();
        JsonNode pick = app(get("/v2/ads").param("slot", "home_top"));
        assertThat(pick.path("kind").textValue()).isEqualTo("DIRECT");
        assertThat(pick.path("ad").path("image_url").textValue()).isEqualTo("signed:" + key + ":3600");
        assertThat(pick.path("ad").path("link_url").textValue()).isEqualTo("https://example.com/a");

        // 노출·클릭 기록 후 목록과 통계
        app(post("/v2/ads/" + id + "/events").contentType(MediaType.APPLICATION_JSON)
                .content("{\"slot\":\"home_top\",\"event\":\"impression\"}"), 204);
        app(post("/v2/ads/" + id + "/events").contentType(MediaType.APPLICATION_JSON)
                .content("{\"slot\":\"home_top\",\"event\":\"click\"}"), 204);
        app(post("/v2/ads/" + id + "/events").contentType(MediaType.APPLICATION_JSON)
                .content("{\"slot\":\"home_top\",\"event\":\"click\"}"), 204);
        JsonNode listed = json(admin(get("/v2/admin/ads"), null), 200).path("ads").get(0);
        assertThat(listed.path("id").textValue()).isEqualTo(id);
        assertThat(listed.path("impressions").longValue()).isEqualTo(1);
        assertThat(listed.path("clicks").longValue()).isEqualTo(2);

        LocalDate today = LocalDate.now(ZoneId.of("Asia/Seoul"));
        JsonNode stats = json(admin(get("/v2/admin/ads/" + id + "/stats")
                .param("from", today.minusDays(2).toString()).param("to", today.toString()), null), 200);
        assertThat(stats.path("days")).hasSize(3);
        assertThat(stats.path("days").get(0).path("impressions").longValue()).isZero();
        assertThat(stats.path("days").get(2).path("day").textValue()).isEqualTo(today.toString());
        assertThat(stats.path("days").get(2).path("clicks").longValue()).isEqualTo(2);
        assertThat(stats.path("impressions").longValue()).isEqualTo(1);
        assertThat(stats.path("clicks").longValue()).isEqualTo(2);
        json(admin(get("/v2/admin/ads/" + id + "/stats").param("from", "2026-13-01"), null), 422);
        json(admin(get("/v2/admin/ads/" + id + "/stats").param("from", today.toString())
                .param("to", today.minusDays(1).toString()), null), 422);
        json(admin(get("/v2/admin/ads/" + UUID.randomUUID() + "/stats"), null), 404);

        // 멈추면 앱은 NETWORK, 다시 켜면 DIRECT, 끝내면 NETWORK
        assertThat(json(admin(patch("/v2/admin/ads/" + id), "{\"status\":\"paused\"}"), 200).path("status").textValue())
                .isEqualTo("paused");
        assertThat(app(get("/v2/ads").param("slot", "home_top")).path("kind").textValue()).isEqualTo("NETWORK");
        json(admin(patch("/v2/admin/ads/" + id), "{\"status\":\"active\",\"priority\":9}"), 200);
        assertThat(app(get("/v2/ads").param("slot", "home_top")).path("kind").textValue()).isEqualTo("DIRECT");
        json(admin(patch("/v2/admin/ads/" + id), "{\"status\":\"ended\"}"), 200);
        assertThat(app(get("/v2/ads").param("slot", "home_top")).path("kind").textValue()).isEqualTo("NETWORK");

        // 수정은 규칙을 다시 검사하고 보내지 않은 칸은 그대로
        json(admin(patch("/v2/admin/ads/" + id), "{\"link_url\":\"ftp://x\"}"), 422);
        JsonNode renamed = json(admin(patch("/v2/admin/ads/" + id), "{\"advertiser_name\":\"새이름\"}"), 200);
        assertThat(renamed.path("link_url").textValue()).isEqualTo("https://example.com/a");
        assertThat(renamed.path("priority").intValue()).isEqualTo(9);
        json(admin(patch("/v2/admin/ads/" + UUID.randomUUID()), "{\"status\":\"paused\"}"), 404);
        json(admin(patch("/v2/admin/ads/" + id), "{\"nope\":1}"), 422);
    }

    @Test
    @DisplayName("자체 광고는 app_path 로 등록하고 audience 가 맞는 쪽에만 간다")
    void houseAd() throws Exception {
        JsonNode created = json(admin(post("/v2/admin/ads"), "{\"kind\":\"house\",\"headline\":\"Pro 를 써 보세요\","
                + "\"slots\":[\"home_top\"],\"audience\":\"free\",\"app_path\":\"/pro\",\"share_percent\":100}"), 201);
        assertThat(created.path("kind").textValue()).isEqualTo("house");
        assertThat(created.path("share_percent").intValue()).isEqualTo(100);
        finishReading();
        JsonNode pick = app(get("/v2/ads").param("slot", "home_top"));
        assertThat(pick.path("kind").textValue()).isEqualTo("HOUSE");
        assertThat(pick.path("ad").path("app_path").textValue()).isEqualTo("/pro");
        json(admin(post("/v2/admin/ads"), "{\"kind\":\"house\",\"headline\":\"x\",\"app_path\":\"pro\"}"), 422);
        json(admin(post("/v2/admin/ads"), "{\"kind\":\"house\",\"headline\":\"x\",\"app_path\":\"/pro\",\"share_percent\":101}"), 422);
        // 비율을 안 보내면 기본 50
        JsonNode plain = json(admin(post("/v2/admin/ads"), "{\"kind\":\"house\",\"headline\":\"y\",\"app_path\":\"/pro\",\"status\":\"paused\"}"), 201);
        assertThat(plain.path("share_percent").intValue()).isEqualTo(50);
    }

    private void finishReading() {
        UUID script = UUID.randomUUID();
        UUID role = UUID.randomUUID();
        UUID line = UUID.randomUUID();
        jdbc.update("INSERT INTO scripts(id,user_id,title,raw_text,raw_hash,source,request_id,request_fingerprint) VALUES (?,?,'갈매기','원문',repeat('0',64),'paste',?,?)",
                script, user, UUID.randomUUID(), "a".repeat(64));
        jdbc.update("INSERT INTO script_characters(id,script_id,name,sort_order) VALUES (?,?,'니나',0)", role, script);
        jdbc.update("INSERT INTO script_lines(id,script_id,ordinal,kind,character_id,text) VALUES (?,?,1,'dialogue',?,'안녕')", line, script, role);
        jdbc.update("""
                INSERT INTO reading_sessions(id,script_id,user_id,request_id,my_character_ids,mode,start_line_id,end_line_id,advance,record,
                                             status,current_line_id)
                VALUES (?,?,?,?,CAST(? AS uuid[]),'read',?,?,'manual',true,'completed',?)
                """, UUID.randomUUID(), script, user, UUID.randomUUID(), "{" + role + "}", line, line, line);
    }

    private static String request(String size, int width, int height, String contentType, long bytes) {
        return "{\"size\":\"" + size + "\",\"width\":" + width + ",\"height\":" + height + ",\"content_type\":\""
                + contentType + "\",\"size_bytes\":" + bytes + "}";
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

    private JsonNode app(MockHttpServletRequestBuilder request) throws Exception {
        return app(request, 200);
    }

    private JsonNode app(MockHttpServletRequestBuilder request, int status) throws Exception {
        var response = mvc.perform(request.header("Authorization", bearer)).andReturn().getResponse();
        assertThat(response.getStatus()).as(response.getContentAsString()).isEqualTo(status);
        return response.getContentAsString().isEmpty() ? null : mapper.readTree(response.getContentAsString());
    }

    @TestConfiguration(proxyBeanMethods = false)
    static class StorageFixture {
        @Bean
        @Primary
        ObjectStorage adStorage() {
            return new ObjectStorage() {
                @Override
                public String presignUpload(String objectKey, String mimeType, long sizeBytes, int expiresInSeconds) {
                    return "put:" + objectKey + ":" + mimeType + ":" + sizeBytes + ":" + expiresInSeconds;
                }

                @Override
                public String presignPlayback(String objectKey, int expiresInSeconds) {
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
