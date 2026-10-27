package com.acttub.actingapi.feature.ads;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.auth.app.JwtService;
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
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

/** app.ads 를 HTTP 와 실제 Postgres 로 본다 — 첫 연습 판정, 고르는 순서, 상세, 노출 하루 한 번·클릭 기록, 404·422. */
@SpringBootTest(properties = {"JWT_SECRET=test-secret", "ACCOUNT_CLEANUP_ENABLED=false",
        "ACCOUNT_HOUSEKEEPING_ENABLED=false", "ADS_PRACTICE_SLOT_PERCENT=0"})
@AutoConfigureMockMvc
class AdEndpointIT {

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        String name = PostgresContainerSupport.createDatabaseName("ad_endpoint");
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
                    OffsetDateTime.of(2026, 9, 1, 0, 0, 0, 0, ZoneOffset.UTC));
        }
        user = UUID.randomUUID();
        jdbc.update("INSERT INTO users(id,status) VALUES (?,'active')", user);
        AccountFixtures.passGate(jdbc, user);
        bearer = "Bearer " + jwt.issueAccessToken(user).value();
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

    private UUID insertAd(String kind, String slots, String audience, String banner, String path) {
        UUID id = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO ads(id,kind,slots,audience,advertiser_name,academy_registration_no,course_name,tuition,headline,
                                image_banner,link_url,app_path)
                VALUES (?,?,CAST(? AS text[]),?,'한빛연기학원','제2026-1호','연기 입시','월 40만원(교재비 포함)','문구',?,
                        'https://example.com',?)
                """, id, kind, slots, audience, banner, path);
        return id;
    }

    private JsonNode json(MockHttpServletRequestBuilder request, int status) throws Exception {
        var response = mvc.perform(request.header("Authorization", bearer)).andReturn().getResponse();
        assertThat(response.getStatus()).as(response.getContentAsString()).isEqualTo(status);
        String body = response.getContentAsString();
        return body.isEmpty() ? null : mapper.readTree(body);
    }

    @Test
    @DisplayName("첫 연습 전엔 NONE, 리딩을 끝내면 직접 → 자체 → NETWORK 순, 연습 중 칸은 비율 0% 라 NONE")
    void pickOrder() throws Exception {
        UUID direct = insertAd("direct", "{home_top}", "all", "https://cdn/banner.png", null);
        insertAd("house", "{home_top,profile_top}", "free", null, "/pro");
        assertThat(json(get("/v2/ads").param("slot", "home_top"), 200).path("kind").asText()).isEqualTo("NONE");

        finishReading();
        JsonNode home = json(get("/v2/ads").param("slot", "home_top"), 200);
        assertThat(home.path("kind").asText()).isEqualTo("DIRECT");
        assertThat(home.path("size").asText()).isEqualTo("BANNER");
        assertThat(home.path("width").asInt()).isEqualTo(320);
        assertThat(home.path("height").asInt()).isEqualTo(50);
        assertThat(home.path("ad").path("id").asText()).isEqualTo(direct.toString());
        assertThat(home.path("ad").path("image_url").asText()).isEqualTo("https://cdn/banner.png");

        JsonNode profile = json(get("/v2/ads").param("slot", "profile_top"), 200);
        assertThat(profile.path("kind").asText()).isEqualTo("HOUSE");
        assertThat(profile.path("ad").path("app_path").asText()).isEqualTo("/pro");

        assertThat(json(get("/v2/ads").param("slot", "settings_top"), 200).path("kind").asText()).isEqualTo("NETWORK");
        assertThat(json(get("/v2/ads").param("slot", "analyzing_wait"), 200).path("kind").asText()).isEqualTo("NONE");

        jdbc.update("UPDATE ads SET status='paused' WHERE id=?", direct);
        assertThat(json(get("/v2/ads").param("slot", "home_top"), 200).path("kind").asText()).isEqualTo("HOUSE");
    }

    @Test
    @DisplayName("상세는 학원 정보를 그대로 주고, 자체 광고·없는 광고는 404 ad_not_found")
    void detail() throws Exception {
        UUID direct = insertAd("direct", "{home_top}", "all", "https://cdn/b.png", null);
        UUID house = insertAd("house", "{home_top}", "all", null, "/challenges");
        JsonNode detail = json(get("/v2/ads/" + direct), 200);
        assertThat(detail.path("advertiser_name").asText()).isEqualTo("한빛연기학원");
        assertThat(detail.path("academy_registration_no").asText()).isEqualTo("제2026-1호");
        assertThat(detail.path("tuition").asText()).isEqualTo("월 40만원(교재비 포함)");
        assertThat(detail.path("link_url").asText()).isEqualTo("https://example.com");
        assertThat(json(get("/v2/ads/" + house), 404).path("detail").asText()).isEqualTo("ad_not_found");
        assertThat(json(get("/v2/ads/" + UUID.randomUUID()), 404).path("detail").asText()).isEqualTo("ad_not_found");
    }

    @Test
    @DisplayName("노출은 하루 한 번, 클릭은 누를 때마다 남는다. 없는 광고 404, 모르는 칸·사건 422")
    void events() throws Exception {
        UUID ad = insertAd("direct", "{home_top}", "all", "https://cdn/b.png", null);
        String impression = "{\"slot\":\"home_top\",\"event\":\"impression\"}";
        String click = "{\"slot\":\"home_top\",\"event\":\"click\"}";
        for (String body : List.of(impression, impression, click, click)) {
            json(post("/v2/ads/" + ad + "/events").contentType(MediaType.APPLICATION_JSON).content(body), 204);
        }
        assertThat(jdbc.queryForObject("SELECT count(*) FROM ad_events WHERE event='impression'", Integer.class)).isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM ad_events WHERE event='click'", Integer.class)).isEqualTo(2);

        assertThat(json(post("/v2/ads/" + UUID.randomUUID() + "/events").contentType(MediaType.APPLICATION_JSON)
                .content(click), 404).path("detail").asText()).isEqualTo("ad_not_found");
        json(post("/v2/ads/" + ad + "/events").contentType(MediaType.APPLICATION_JSON)
                .content("{\"slot\":\"nope\",\"event\":\"click\"}"), 422);
        json(post("/v2/ads/" + ad + "/events").contentType(MediaType.APPLICATION_JSON)
                .content("{\"slot\":\"home_top\",\"event\":\"view\"}"), 422);
        json(get("/v2/ads").param("slot", "nope"), 422);
        json(get("/v2/ads"), 422);
    }
}
