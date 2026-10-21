package com.acttub.actingapi.feature.reading;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import java.nio.file.Files;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CopyOnWriteArrayList;

import com.acttub.actingapi.feature.auth.app.JwtService;
import com.acttub.actingapi.feature.reading.app.PronunciationAudio;
import com.acttub.actingapi.feature.reading.app.PronunciationReportRepository;
import com.acttub.actingapi.feature.reading.app.PronunciationScorer;
import com.acttub.actingapi.feature.reading.app.PronunciationWorker;
import com.acttub.actingapi.feature.reading.domain.PronunciationRules.Phone;
import com.acttub.actingapi.feature.reading.domain.PronunciationRules.ScoredLine;
import com.acttub.actingapi.feature.reading.domain.PronunciationRules.Word;
import com.acttub.actingapi.support.AccountFixtures;
import com.acttub.actingapi.support.MutableClock;
import com.acttub.actingapi.support.PostgresContainerSupport;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
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
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

/**
 * reading.pronunciation(실험, SOMA-606) — 허용 사용자가 끝낸 회차를 조회하면 큐에 들고, 일꾼이 줄 녹음을 채점해 보고서로
 * 닫는 것을 HTTP 와 실제 Postgres 로 본다. 채점 서비스와 스토리지는 가짜다. 예약 일꾼은 한 시간에 한 번이라 테스트가 직접 돌린다.
 */
@SpringBootTest(properties = {
    "JWT_SECRET=test-secret",
    "ACCOUNT_CLEANUP_ENABLED=false",
    "ACCOUNT_HOUSEKEEPING_ENABLED=false",
    "PRON_REPORT_ENABLED=true",
    "PRON_SCORER_URL=http://pron.test",
    "PRON_REPORT_ALLOWED_USERS=" + ReadingPronunciationIT.OWNER + "," + ReadingPronunciationIT.OTHER,
    "PRON_REPORT_MAX_ATTEMPTS=2",
    "PRON_REPORT_POLL_MS=3600000"
})
@AutoConfigureMockMvc
@Import({MutableClock.Fixture.class, ReadingPronunciationIT.Fakes.class})
class ReadingPronunciationIT {
    static final String OWNER = "11111111-1111-4111-8111-111111111111";
    static final String OTHER = "22222222-2222-4222-8222-222222222222";
    private static final OffsetDateTime PUBLISHED = OffsetDateTime.of(2026, 10, 1, 0, 0, 0, 0, ZoneOffset.UTC);

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        String name = PostgresContainerSupport.createDatabaseName("reading_pronunciation");
        registry.add("spring.datasource.url", () -> PostgresContainerSupport.jdbcUrlFor(name));
        registry.add("spring.datasource.username", PostgresContainerSupport.POSTGRES::getUsername);
        registry.add("spring.datasource.password", PostgresContainerSupport.POSTGRES::getPassword);
    }

    @TestConfiguration(proxyBeanMethods = false)
    static class Fakes {
        static final List<String> DOWNLOADED = new CopyOnWriteArrayList<>();
        static final List<String> SCORED = new CopyOnWriteArrayList<>();
        static volatile boolean failing;

        @Bean
        @Primary
        PronunciationAudio fakePronunciationAudio() {
            return (key, destination) -> {
                DOWNLOADED.add(key);
                try {
                    Files.writeString(destination, "audio");
                } catch (java.io.IOException failure) {
                    throw new java.io.UncheckedIOException(failure);
                }
            };
        }

        @Bean
        @Primary
        PronunciationScorer fakePronunciationScorer() {
            return (path, contentType, text) -> {
                if (failing) {
                    throw new IllegalStateException("pronunciation scorer returned 503");
                }
                SCORED.add(text);
                Phone phone = new Phone("ㄷ", "ㄷ", 1.0, false, 0, 0, 100, false);
                return new PronunciationScorer.Scored(new ScoredLine(text, List.of(new Word(0, text, false, List.of(phone)))),
                        "pron-fake");
            };
        }
    }

    @Autowired
    MockMvc mvc;
    @Autowired
    JdbcTemplate jdbc;
    @Autowired
    ObjectMapper mapper;
    @Autowired
    JwtService jwt;
    @Autowired
    MutableClock clock;
    @Autowired
    PronunciationWorker worker;
    @Autowired
    PronunciationReportRepository reports;

    private String bearer;
    private UUID session;
    private List<UUID> ninaLines;

    @BeforeEach
    void setUp() throws Exception {
        jdbc.execute("TRUNCATE TABLE users,consent_documents RESTART IDENTITY CASCADE");
        for (String type : List.of("terms", "privacy", "ai_analysis", "retention")) {
            jdbc.update("""
                    INSERT INTO consent_documents(id,type,version,title,body,required,published_at)
                    VALUES (?,?,'v1',?,?,?,?)
                    """, UUID.randomUUID(), type, type + " 제목", type + " 본문", !"retention".equals(type), PUBLISHED);
        }
        clock.set(Instant.parse("2026-10-21T08:00:00Z"));
        Fakes.DOWNLOADED.clear();
        Fakes.SCORED.clear();
        Fakes.failing = false;
        member(UUID.fromString(OWNER));
        member(UUID.fromString(OTHER));
        bearer = bearer(UUID.fromString(OWNER));
        session = startSession(bearer);
    }

    @Test
    @DisplayName("reading.pronunciation: 끝나지 않은 회차는 not_ready, 끝낸 회차를 처음 조회하면 queued 로 한 번만 큐에 들고, "
            + "일꾼이 받아쓴 줄만 채점해 done 보고서를 낸다")
    void finishedSessionIsQueuedOnceAndScored() throws Exception {
        record(List.of("대사 1", "대사 3", "대사 5"));
        assertThat(json(get("/v2/reading/sessions/{id}/pronunciation", session), bearer, 200).path("status").textValue())
                .isEqualTo("not_ready");
        assertThat(jdbc.queryForObject("SELECT count(*) FROM reading_pronunciation_reports", Integer.class)).isZero();

        complete();
        JsonNode queued = json(get("/v2/reading/sessions/{id}/pronunciation", session), bearer, 200);
        assertThat(queued.path("status").textValue()).isEqualTo("queued");
        assertThat(queued.path("report").isNull()).isTrue();
        json(get("/v2/reading/sessions/{id}/pronunciation", session), bearer, 200);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM reading_pronunciation_reports", Integer.class)).isEqualTo(1);

        assertThat(worker.runOnce()).isTrue();
        assertThat(worker.runOnce()).isFalse();
        assertThat(Fakes.SCORED).containsExactly("대사 1", "대사 3", "대사 5");
        assertThat(Fakes.DOWNLOADED).containsExactly("rec/" + ninaLines.get(0), "rec/" + ninaLines.get(1), "rec/" + ninaLines.get(2));

        JsonNode done = json(get("/v2/reading/sessions/{id}/pronunciation", session), bearer, 200);
        assertThat(done.path("status").textValue()).isEqualTo("done");
        assertThat(done.path("report").path("summary").path("linesUsed").intValue()).isEqualTo(3);
        Map<String, Object> row = jdbc.queryForMap(
                "SELECT model_version, attempt_count, lease_token, failure FROM reading_pronunciation_reports");
        assertThat(row.get("model_version")).isEqualTo("pron-fake");
        assertThat(row.get("attempt_count")).isEqualTo(1);
        assertThat(row.get("lease_token")).isNull();
        assertThat(row.get("failure")).isNull();
    }

    @Test
    @DisplayName("reading.pronunciation: 받아쓴 글이 없는 줄만 있으면 채점하지 않고 skipped 로 닫는다")
    void withoutTranscriptsTheReportIsSkipped() throws Exception {
        record(java.util.Arrays.asList(null, " ", null));
        complete();
        json(get("/v2/reading/sessions/{id}/pronunciation", session), bearer, 200);

        assertThat(worker.runOnce()).isTrue();

        assertThat(Fakes.SCORED).isEmpty();
        JsonNode skipped = json(get("/v2/reading/sessions/{id}/pronunciation", session), bearer, 200);
        assertThat(skipped.path("status").textValue()).isEqualTo("skipped");
        assertThat(skipped.path("report").path("skippedLines")).hasSize(3);
    }

    @Test
    @DisplayName("reading.pronunciation: 채점이 실패하면 시도가 남았을 때 queued 로 돌아가고, 마지막 시도면 failed 로 닫는다")
    void failuresAreRetriedThenClosed() throws Exception {
        record(List.of("대사 1", "대사 3", "대사 5"));
        complete();
        json(get("/v2/reading/sessions/{id}/pronunciation", session), bearer, 200);
        Fakes.failing = true;

        assertThatThrownBy(worker::runOnce).isInstanceOf(IllegalStateException.class);
        Map<String, Object> retried = jdbc.queryForMap("SELECT status, failure, attempt_count FROM reading_pronunciation_reports");
        assertThat(retried.get("status")).isEqualTo("queued");
        assertThat(retried.get("failure")).isEqualTo("IllegalStateException");
        assertThat(retried.get("attempt_count")).isEqualTo(1);

        assertThatThrownBy(worker::runOnce).isInstanceOf(IllegalStateException.class);
        assertThat(json(get("/v2/reading/sessions/{id}/pronunciation", session), bearer, 200).path("status").textValue())
                .isEqualTo("failed");
        assertThat(worker.runOnce()).isFalse();
    }

    @Test
    @DisplayName("reading.pronunciation: 임대가 끝난 running 은 다른 일꾼이 다시 집고, 옛 임대로는 닫지 못하며, 시도를 다 쓰고 "
            + "임대가 끝나면 lease_expired 로 실패한다")
    void expiredLeasesAreReclaimedOrClosed() throws Exception {
        record(List.of("대사 1", "대사 3", "대사 5"));
        complete();
        json(get("/v2/reading/sessions/{id}/pronunciation", session), bearer, 200);
        Instant now = clock.instant();
        UUID first = UUID.randomUUID();
        UUID second = UUID.randomUUID();

        var claimed = reports.claimNext(first, Duration.ofMinutes(1), 2, now);
        assertThat(claimed.sessionId()).isEqualTo(session);
        assertThat(claimed.attempt()).isEqualTo(1);
        assertThat(reports.claimNext(second, Duration.ofMinutes(1), 2, now.plusSeconds(30))).isNull();

        var again = reports.claimNext(second, Duration.ofMinutes(1), 2, now.plusSeconds(120));
        assertThat(again.reportId()).isEqualTo(claimed.reportId());
        assertThat(again.attempt()).isEqualTo(2);
        assertThat(reports.fail(claimed.reportId(), first, "late", true, now.plusSeconds(130))).isFalse();
        assertThat(reports.lines(session)).extracting(PronunciationReportRepository.LineSource::lineNo).containsExactly(1, 3, 5);

        assertThat(reports.claimNext(UUID.randomUUID(), Duration.ofMinutes(1), 2, now.plusSeconds(600))).isNull();
        Map<String, Object> row = jdbc.queryForMap("SELECT status, failure FROM reading_pronunciation_reports");
        assertThat(row.get("status")).isEqualTo("failed");
        assertThat(row.get("failure")).isEqualTo("lease_expired");
    }

    @Test
    @DisplayName("reading.pronunciation: 허용 목록 밖이면 404 pronunciation_not_available, 남의 회차는 404 session_not_found")
    void accessIsLimited() throws Exception {
        complete();
        UUID stranger = UUID.randomUUID();
        member(stranger);

        assertThat(perform(get("/v2/reading/sessions/{id}/pronunciation", session), bearer(stranger), 404).getContentAsString())
                .contains("pronunciation_not_available");
        assertThat(perform(get("/v2/reading/sessions/{id}/pronunciation", session), bearer(UUID.fromString(OTHER)), 404)
                .getContentAsString()).contains("session_not_found");
        assertThat(jdbc.queryForObject("SELECT count(*) FROM reading_pronunciation_reports", Integer.class)).isZero();
    }

    private void complete() {
        jdbc.update("UPDATE reading_sessions SET status='completed', ended_at=now(), current_line_id=NULL WHERE id=?", session);
    }

    private void record(List<String> transcripts) {
        for (int index = 0; index < ninaLines.size(); index++) {
            UUID line = ninaLines.get(index);
            String transcript = transcripts.get(index);
            jdbc.update("""
                    INSERT INTO reading_recordings(id,user_id,reading_session_id,line_id,request_id,attempt_no,object_key,
                                                   content_type,byte_size,duration_ms,transcript,transcript_source)
                    VALUES (?,?,?,?,?,1,?,'audio/mp4',20000,1500,?,?)
                    """, UUID.randomUUID(), UUID.fromString(OWNER), session, line, UUID.randomUUID(), "rec/" + line,
                    transcript, transcript == null ? "none" : "stt");
        }
    }

    /** 배역 둘, 대사 여섯(니나·트레플레프 번갈아). 니나를 읽는 회차를 대본 전체 구간으로 시작한다. */
    private UUID startSession(String authorization) throws Exception {
        ObjectNode body = mapper.createObjectNode();
        body.put("request_id", UUID.randomUUID().toString());
        body.put("title", "갈매기");
        body.put("source", "paste");
        body.put("raw_text", "원문");
        ArrayNode characters = body.putArray("characters");
        for (String name : List.of("니나", "트레플레프")) {
            characters.addObject().put("name", name);
        }
        ArrayNode lines = body.putArray("lines");
        for (int index = 0; index < 6; index++) {
            lines.addObject().put("ordinal", index + 1).put("kind", "dialogue").put("character_index", index % 2)
                    .put("text", "대사 " + (index + 1));
        }
        JsonNode saved = json(post("/v2/reading/scripts").content(body.toString()), authorization, 201);
        List<UUID> all = new ArrayList<>();
        for (JsonNode line : saved.path("lines")) {
            all.add(UUID.fromString(line.path("id").textValue()));
        }
        ninaLines = List.of(all.get(0), all.get(2), all.get(4));
        UUID scriptId = UUID.fromString(saved.path("id").textValue());
        String nina = saved.path("characters").get(0).path("id").textValue();

        ObjectNode start = mapper.createObjectNode();
        start.put("request_id", UUID.randomUUID().toString());
        start.putArray("my_character_ids").add(nina);
        start.put("mode", "read");
        start.put("start_line_id", all.getFirst().toString());
        start.put("end_line_id", all.getLast().toString());
        start.put("advance", "silence");
        start.put("record", true);
        JsonNode started = json(post("/v2/reading/scripts/{id}/sessions", scriptId).content(start.toString()),
                authorization, 201);
        return UUID.fromString(started.path("id").textValue());
    }

    private void member(UUID id) {
        jdbc.update("INSERT INTO users(id,status) VALUES (?,'active')", id);
        jdbc.update("INSERT INTO user_identities(id,user_id,provider,provider_uid) VALUES (?,?,'google',?)",
                UUID.randomUUID(), id, "g-" + id);
        AccountFixtures.passGate(jdbc, id);
    }

    private String bearer(UUID userId) {
        return "Bearer " + jwt.issueAccessToken(userId).value();
    }

    private JsonNode json(MockHttpServletRequestBuilder request, String authorization, int status) throws Exception {
        String body = perform(request, authorization, status).getContentAsString();
        return body.isEmpty() ? mapper.nullNode() : mapper.readTree(body);
    }

    private MockHttpServletResponse perform(MockHttpServletRequestBuilder request, String authorization, int status)
            throws Exception {
        MockHttpServletResponse response = mvc.perform(request
                        .header("Authorization", authorization)
                        .contentType(MediaType.APPLICATION_JSON))
                .andReturn()
                .getResponse();
        assertThat(response.getStatus()).as(response.getContentAsString()).isEqualTo(status);
        return response;
    }
}
