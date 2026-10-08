package com.acttub.actingapi.feature.audition;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;

import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import com.acttub.actingapi.feature.audition.app.AuditionService;
import com.acttub.actingapi.feature.audition.app.AuditionSources;
import com.acttub.actingapi.feature.audition.domain.AuditionPosting;
import com.acttub.actingapi.support.MutableClock;
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
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;

/**
 * app.audition — 켜진 서버의 수집(upsert·삭제 규칙)과 {@code GET /v2/auditions}. 출처는 메모리 가짜라 바깥으로 나가는
 * 요청이 없다. 스케줄은 꺼 두고({@code cron=-}, 기동 뒤 수집은 한 시간 뒤) 수집은 서비스를 직접 부른다.
 */
@SpringBootTest(properties = {"JWT_SECRET=test-secret", "AUDITION_ENABLED=true",
        "AUDITION_SOURCES=shinsee,emk,sejong,otr", "AUDITION_COLLECT_CRON=-",
        "AUDITION_COLLECT_STARTUP_DELAY_MS=3600000",
        "ACCOUNT_CLEANUP_ENABLED=false", "ACCOUNT_HOUSEKEEPING_ENABLED=false"})
@AutoConfigureMockMvc
@Import(AuditionEndpointIT.Fixture.class)
class AuditionEndpointIT {

    /** 2026-10-08 09:00 KST. */
    private static final Instant NOW = Instant.parse("2026-10-08T00:00:00Z");
    private static final LocalDate TODAY = LocalDate.of(2026, 10, 8);

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        String name = PostgresContainerSupport.createDatabaseName("audition_endpoint");
        registry.add("spring.datasource.url", () -> PostgresContainerSupport.jdbcUrlFor(name));
        registry.add("spring.datasource.username", PostgresContainerSupport.POSTGRES::getUsername);
        registry.add("spring.datasource.password", PostgresContainerSupport.POSTGRES::getPassword);
    }

    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate jdbc;
    @Autowired ObjectMapper mapper;
    @Autowired AuditionService auditions;
    @Autowired FakeSources sources;
    @Autowired MutableClock clock;

    @BeforeEach
    void reset() {
        jdbc.execute("TRUNCATE TABLE audition_postings RESTART IDENTITY");
        sources.postings.clear();
        sources.calls.clear();
        clock.set(NOW);
    }

    private static AuditionPosting posting(String source, String ref, String title, String pay, LocalDate end,
            String status, LocalDate posted) {
        return new AuditionPosting(source, ref, title, "theater", pay, null, end, status, posted,
                "https://example.com/" + source + "/" + ref);
    }

    @Test
    @DisplayName("같은 공고를 두 번 모으면 행은 하나이고 칸은 두 번째 값이다(first_seen_at 은 처음 그대로)")
    void collectingTwiceUpdatesTheSameRow() {
        sources.postings.put("otr", List.of(posting("otr", "1", "연극 배우 모집", "협의", TODAY.plusDays(5), null,
                TODAY)));
        auditions.collect();
        clock.set(NOW.plusSeconds(43_200));
        sources.postings.put("otr", List.of(posting("otr", "1", "연극 배우 모집 (2차)", "회당 5만원",
                TODAY.plusDays(9), null, TODAY)));
        auditions.collect();

        List<Map<String, Object>> rows = jdbc.queryForList("""
                SELECT title,pay_text,apply_end,first_seen_at,last_seen_at FROM audition_postings
                WHERE source='otr' AND source_ref='1'""");
        assertThat(rows).hasSize(1);
        assertThat(rows.get(0)).containsEntry("title", "연극 배우 모집 (2차)").containsEntry("pay_text", "회당 5만원");
        assertThat(rows.get(0).get("apply_end").toString()).isEqualTo("2026-10-17");
        assertThat(((java.sql.Timestamp) rows.get(0).get("first_seen_at")).toInstant()).isEqualTo(NOW);
        assertThat(((java.sql.Timestamp) rows.get(0).get("last_seen_at")).toInstant())
                .isEqualTo(NOW.plusSeconds(43_200));
    }

    @Test
    @DisplayName("마감일이 어제인 공고와 '(완료)' 가 붙은 제목은 GET 에 나오지 않는다")
    void closedPostingsAreHidden() throws Exception {
        sources.postings.put("otr", List.of(
                posting("otr", "yesterday", "연극 배우 모집", null, TODAY.minusDays(1), null, TODAY.minusDays(9)),
                posting("otr", "today", "연극 배우 모집", null, TODAY, null, TODAY.minusDays(9)),
                posting("otr", "no-end-new", "연극 배우 모집", null, null, null, TODAY.minusDays(45)),
                posting("otr", "no-end-old", "연극 배우 모집", null, null, null, TODAY.minusDays(46)),
                posting("otr", "status-closed", "연극 배우 모집", null, TODAY.plusDays(3), "접수마감", TODAY)));
        sources.postings.put("emk", List.of(
                posting("emk", "done", "<몬테크리스토> 오디션 공지 (완료)", null, null, "마감", TODAY)));
        auditions.collect();

        JsonNode body = getJson("/v2/auditions");
        assertThat(ids(body)).containsExactly("otr-today", "otr-no-end-new");
    }

    @Test
    @DisplayName("수집 끝에 마감 30일이 지났거나, 마감일 없이 게시 180일이 지난 행을 지운다")
    void collectEndsWithTheDeletionRule() {
        sources.postings.put("otr", List.of(
                posting("otr", "ended-30", "a", null, TODAY.minusDays(30), null, TODAY.minusDays(60)),
                posting("otr", "ended-31", "b", null, TODAY.minusDays(31), null, TODAY.minusDays(60)),
                posting("otr", "posted-180", "c", null, null, null, TODAY.minusDays(180)),
                posting("otr", "posted-181", "d", null, null, null, TODAY.minusDays(181))));
        auditions.collect();

        assertThat(jdbc.queryForList("SELECT source_ref FROM audition_postings ORDER BY source_ref", String.class))
                .containsExactly("ended-30", "posted-180");
    }

    @Test
    @DisplayName("0건이 나온 출처의 기존 행은 지우지 않는다")
    void emptyCollectionKeepsRows() {
        sources.postings.put("otr", List.of(posting("otr", "1", "a", null, TODAY.plusDays(5), null, TODAY)));
        auditions.collect();
        sources.postings.clear();
        auditions.collect();

        assertThat(jdbc.queryForObject("SELECT count(*) FROM audition_postings", Integer.class)).isEqualTo(1);
    }

    @Test
    @DisplayName("GET /v2/auditions 는 로그인 없이 스펙의 칸 그대로(snake_case, null 은 키째) 마감 순으로 낸다")
    void endpointShape() throws Exception {
        JsonNode empty = getJson("/v2/auditions");
        assertThat(empty.path("items").isArray()).isTrue();
        assertThat(empty.path("items")).isEmpty();
        assertThat(empty.has("collected_at")).isTrue();
        assertThat(empty.path("collected_at").isNull()).isTrue();

        sources.postings.put("shinsee", List.of(new AuditionPosting("shinsee", "66", "2027 뮤지컬 <아이다> 공개 오디션",
                "musical", null, TODAY.minusDays(3), TODAY.plusDays(10), "접수중", TODAY.minusDays(4),
                "https://www.iseensee.com/Home/Community/Audition.aspx?mode=v&Id=66")));
        sources.postings.put("otr", List.of(new AuditionPosting("otr", "22430", "[뮤지컬] 가족뮤지컬 배우오디션",
                "musical", "협의", null, TODAY.plusDays(2), null, TODAY, "https://otr.co.kr/audition/?vid=22430")));
        auditions.collect();

        JsonNode body = getJson("/v2/auditions");
        assertThat(body.properties()).extracting(Map.Entry::getKey).containsExactlyInAnyOrder("items", "collected_at");
        assertThat(body.path("collected_at").textValue()).isEqualTo("2026-10-08T00:00:00.000000Z");
        assertThat(ids(body)).containsExactly("otr-22430", "shinsee-66");
        JsonNode otr = body.path("items").get(0);
        assertThat(otr.properties()).extracting(Map.Entry::getKey).containsExactlyInAnyOrder(
                "id", "title", "category", "source", "source_name", "pay_text", "apply_start", "apply_end",
                "status_text", "posted_on", "source_url");
        assertThat(otr.path("source_name").textValue()).isEqualTo("OTR");
        assertThat(otr.path("pay_text").textValue()).isEqualTo("협의");
        assertThat(otr.path("apply_start").isNull()).isTrue();
        assertThat(otr.path("status_text").isNull()).isTrue();
        assertThat(otr.path("apply_end").textValue()).isEqualTo("2026-10-10");
        assertThat(otr.path("posted_on").textValue()).isEqualTo("2026-10-08");
        JsonNode shinsee = body.path("items").get(1);
        assertThat(shinsee.path("source_name").textValue()).isEqualTo("신시컴퍼니");
        assertThat(shinsee.path("title").textValue()).isEqualTo("2027 뮤지컬 <아이다> 공개 오디션");
        assertThat(shinsee.path("apply_start").textValue()).isEqualTo("2026-10-05");
        assertThat(shinsee.path("source_url").textValue())
                .isEqualTo("https://www.iseensee.com/Home/Community/Audition.aspx?mode=v&Id=66");

        // 만료된 토큰을 붙여도 401 이 아니다 — 토큰을 보지 않는 공개 경로다.
        assertThat(mvc.perform(get("/v2/auditions").header("Authorization", "Bearer expired.token.value"))
                .andReturn().getResponse().getStatus()).isEqualTo(200);
    }

    @Test
    @DisplayName("오늘(KST) 은 한국 날짜다 — 마감일 10월 8일 공고는 10월 8일 23:30 KST 까지 보이고 자정이 지나면 사라진다")
    void todayIsTheKoreanDate() throws Exception {
        sources.postings.put("otr", List.of(posting("otr", "1", "a", null, TODAY, null, TODAY)));
        auditions.collect();

        clock.set(OffsetDateTime.of(2026, 10, 8, 23, 30, 0, 0, ZoneOffset.ofHours(9)).toInstant());
        assertThat(ids(getJson("/v2/auditions"))).containsExactly("otr-1");
        clock.set(OffsetDateTime.of(2026, 10, 9, 0, 30, 0, 0, ZoneOffset.ofHours(9)).toInstant());
        assertThat(ids(getJson("/v2/auditions"))).isEmpty();
    }

    private List<String> ids(JsonNode body) {
        List<String> ids = new ArrayList<>();
        body.path("items").forEach(item -> ids.add(item.path("id").textValue()));
        return ids;
    }

    private JsonNode getJson(String path) throws Exception {
        var response = mvc.perform(get(path)).andReturn().getResponse();
        assertThat(response.getStatus()).isEqualTo(200);
        return mapper.readTree(response.getContentAsString());
    }

    @TestConfiguration
    static class Fixture {
        @Bean
        @Primary
        FakeSources fakeAuditionSources() {
            return new FakeSources();
        }

        @Bean
        @Primary
        MutableClock mutableClock() {
            return new MutableClock(NOW);
        }
    }

    /** 네트워크 대신 넣어 둔 공고를 돌려준다. */
    static final class FakeSources implements AuditionSources {
        final Map<String, List<AuditionPosting>> postings = new LinkedHashMap<>();
        final List<String> calls = new ArrayList<>();

        @Override
        public List<AuditionPosting> read(String source, LocalDate today) {
            calls.add(source);
            return postings.getOrDefault(source, List.of());
        }
    }
}
