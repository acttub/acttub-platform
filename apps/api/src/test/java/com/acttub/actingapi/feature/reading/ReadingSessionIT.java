package com.acttub.actingapi.feature.reading;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.Statement;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.IntSupplier;

import com.acttub.actingapi.feature.auth.app.JwtService;
import com.acttub.actingapi.integration.storage.ObjectStorage;
import com.acttub.actingapi.integration.storage.StoredObjectMetadata;
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
 * reading.cast·reading.session 의 "검증 방법" 가운데 서버가 맡는 항목을 HTTP 와 실제 Postgres 로 본다. 녹음 행은 아직
 * API 가 없어(RA3) 표를 직접 채워 집계(녹음된 줄 수)와 삭제를 본다. 오브젝트 스토리지는 메모리의 가짜다.
 *
 * <p>여기서 보지 못하는 것: 상대역 목소리 배정·모델 준비·침묵 감지·STT 대조·가리기·완료 화면 문구·가이드·배경 전환(모두
 * 기기), 탈퇴 뒤 회차 파기(RA5).
 */
@SpringBootTest(properties = {
    "JWT_SECRET=test-secret",
    "ACCOUNT_CLEANUP_ENABLED=false",
    "ACCOUNT_HOUSEKEEPING_ENABLED=false",
    // 겹쳐 보낸 시작 둘과 이관 중의 저장은 저마다 커넥션을 쥔 채 잠금을 기다린다.
    "spring.datasource.hikari.maximum-pool-size=12"
})
@AutoConfigureMockMvc
@Import({MutableClock.Fixture.class, ReadingSessionIT.StorageFixture.class})
class ReadingSessionIT {
    private static final AtomicInteger ADDRESSES = new AtomicInteger();
    private static final long START_GATE = 546_002L;
    private static final long TRANSFER_GATE = 546_003L;
    private static final OffsetDateTime PUBLISHED = OffsetDateTime.of(2026, 10, 1, 0, 0, 0, 0, ZoneOffset.UTC);
    private static String database;

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        String name = PostgresContainerSupport.createDatabaseName("reading_session");
        database = name;
        registry.add("spring.datasource.url", () -> PostgresContainerSupport.jdbcUrlFor(name));
        registry.add("spring.datasource.username", PostgresContainerSupport.POSTGRES::getUsername);
        registry.add("spring.datasource.password", PostgresContainerSupport.POSTGRES::getPassword);
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
    FakeStorage storage;

    private final Map<String, UUID> documents = new LinkedHashMap<>();
    private UUID member;
    private String bearer;
    private String address;

    /** 저장된 대본 — 배역 셋(니나·트레플레프·아르카디나), 줄 열(장면·지문·대사 여덟). */
    private Script script;

    @BeforeEach
    void setUp() throws Exception {
        jdbc.execute("DROP TRIGGER IF EXISTS fail_session_insert ON reading_sessions");
        jdbc.execute("DROP TRIGGER IF EXISTS hold_session_insert ON reading_sessions");
        jdbc.execute("DROP TRIGGER IF EXISTS hold_session_reassign ON reading_sessions");
        jdbc.execute("TRUNCATE TABLE users,consent_documents RESTART IDENTITY CASCADE");
        documents.clear();
        for (String type : List.of("terms", "privacy", "ai_analysis", "retention")) {
            UUID id = UUID.randomUUID();
            documents.put(type, id);
            jdbc.update("""
                    INSERT INTO consent_documents(id,type,version,title,body,required,published_at)
                    VALUES (?,?,'v1',?,?,?,?)
                    """, id, type, type + " 제목", type + " 본문", !"retention".equals(type), PUBLISHED);
        }
        storage.objects.clear();
        clock.set(Instant.now().truncatedTo(java.time.temporal.ChronoUnit.SECONDS));
        address = "10.48.0." + ADDRESSES.incrementAndGet();
        member = member();
        bearer = "Bearer " + jwt.issueAccessToken(member).value();
        script = saveScript(bearer);
    }

    @Test
    @DisplayName("reading.session·reading.cast: 회차 시작 — reading_sessions 1행, in_progress, current_line_id 는 구간의 첫 대사 줄, started_at 있음, my_character_ids 에 고른 둘. 같은 요청 id 로 다시 — 같은 회차 id 이고 행 하나")
    void readingSession_startCreatesOneOpenSessionAndReplaysTheSameRequest() throws Exception {
        UUID requestId = UUID.randomUUID();
        ObjectNode body = start(requestId, List.of(script.nina, script.treplev), "read", script.dialogue(1), script.dialogue(8), "silence", true);

        JsonNode started = json(post("/v2/reading/scripts/{id}/sessions", script.id).content(body.toString()), 201);

        assertThat(count("reading_sessions")).isEqualTo(1);
        assertThat(started.fieldNames()).toIterable().containsExactlyInAnyOrder(
                "id", "ordinal", "status", "my_character_ids", "my_character_names", "range", "my_dialogue_count",
                "recorded_line_count", "elapsed_seconds", "started_at", "ended_at", "script_id", "mode", "advance", "record",
                "start_line_id", "end_line_id", "current_line_id", "progress_seq", "line_results", "recordings");
        assertThat(started.path("status").textValue()).isEqualTo("in_progress");
        assertThat(started.path("current_line_id").textValue()).as("구간의 첫 대사 줄").isEqualTo(script.dialogue(1).toString());
        assertThat(Instant.parse(started.path("started_at").textValue())).as("시각은 앱 시계로 찍는다").isEqualTo(clock.instant());
        assertThat(started.path("ended_at").isNull()).isTrue();
        assertThat(started.path("my_character_ids")).extracting(JsonNode::textValue)
                .containsExactly(script.nina.toString(), script.treplev.toString());
        assertThat(started.path("my_character_names")).extracting(JsonNode::textValue).containsExactly("니나", "트레플레프");
        assertThat(started.path("ordinal").intValue()).isEqualTo(1);
        assertThat(started.path("range").path("start_dialogue_no").intValue()).isEqualTo(1);
        assertThat(started.path("range").path("end_dialogue_no").intValue()).isEqualTo(8);
        assertThat(started.path("my_dialogue_count").intValue()).as("니나 4 + 트레플레프 2").isEqualTo(6);
        assertThat(started.path("recorded_line_count").intValue()).isZero();
        assertThat(started.path("elapsed_seconds").intValue()).isZero();
        assertThat(started.path("progress_seq").longValue()).isZero();
        assertThat(started.path("line_results")).isEmpty();
        assertThat(started.path("recordings")).isEmpty();
        assertThat(started.path("mode").textValue()).isEqualTo("read");
        assertThat(started.path("advance").textValue()).isEqualTo("silence");
        assertThat(started.path("record").booleanValue()).isTrue();
        assertThat(started.path("script_id").textValue()).isEqualTo(script.id.toString());

        JsonNode replayed = json(post("/v2/reading/scripts/{id}/sessions", script.id).content(body.toString()), 200);
        assertThat(replayed.path("id").textValue()).isEqualTo(started.path("id").textValue());
        assertThat(count("reading_sessions")).isEqualTo(1);

        ObjectNode other = start(requestId, List.of(script.nina), "quiz", script.dialogue(1), script.dialogue(8), "manual", false);
        assertThat(json(post("/v2/reading/scripts/{id}/sessions", script.id).content(other.toString()), 422))
                .as("같은 요청 id 에 다른 속성").isEqualTo(mapper.readTree("{\"detail\":\"request_fingerprint_mismatch\"}"));
        assertThat(count("reading_sessions")).isEqualTo(1);
    }

    @Test
    @DisplayName("reading.session: 열린 회차가 있는 대본에서 \"새로운 연습\" — 이전 회차는 stopped, 새 회차는 in_progress 이고 그 대본의 in_progress 는 하나다. 겹쳐 시작해도 하나다(부분 유일 인덱스 경합)")
    void readingSession_aNewSessionStopsTheOpenOneEvenWhenStartsOverlap() throws Exception {
        String first = startSession(List.of(script.nina)).path("id").textValue();
        json(patch("/v2/reading/sessions/{id}/progress", first).content("{\"progress_seq\":1,\"current_line_id\":\""
                + script.dialogue(3) + "\",\"elapsed_seconds\":30}"), 200);
        clock.advance(Duration.ofSeconds(1));

        JsonNode second = startSession(List.of(script.treplev));

        assertThat(second.path("status").textValue()).isEqualTo("in_progress");
        assertThat(second.path("ordinal").intValue()).isEqualTo(2);
        assertThat(jdbc.queryForObject("SELECT status FROM reading_sessions WHERE id=?", String.class, UUID.fromString(first)))
                .isEqualTo("stopped");
        assertThat(jdbc.queryForObject("SELECT current_line_id FROM reading_sessions WHERE id=?", UUID.class, UUID.fromString(first)))
                .as("stopped 는 중단 위치를 유지한다").isEqualTo(script.dialogue(3));
        assertThat(openSessions()).isEqualTo(1);

        // 시작 둘을 겹쳐 보낸다 — 새 회차의 INSERT 를 문 앞에 세우고 그 사이 또 하나를 보낸다.
        holdSessionInserts();
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try (Connection gate = outsideConnection()) {
            try (Statement statement = gate.createStatement()) {
                statement.execute("SELECT pg_advisory_lock(" + START_GATE + ")");
            }
            Future<Integer> firstStart = pool.submit(() -> startStatus(List.of(script.nina)));
            awaitUntil("첫 시작이 문 앞에 서기", 1, this::lockWaiters);
            Future<Integer> secondStart = pool.submit(() -> startStatus(List.of(script.arkadina)));
            awaitUntil("둘째 시작이 대본 행에서 줄을 서기", 2, this::lockWaiters);
            try (Statement statement = gate.createStatement()) {
                statement.execute("SELECT pg_advisory_unlock(" + START_GATE + ")");
            }
            assertThat(firstStart.get()).isEqualTo(201);
            assertThat(secondStart.get()).isEqualTo(201);
        } finally {
            pool.shutdownNow();
        }
        assertThat(count("reading_sessions")).isEqualTo(4);
        assertThat(openSessions()).as("열린 회차는 대본당 하나다").isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM reading_sessions WHERE status='stopped'", Integer.class)).isEqualTo(3);
    }

    @Test
    @DisplayName("reading.session: 시작 트랜잭션을 실패시킴 — 기존 열린 회차가 그대로고 새 회차도 없다. 배역 0개·다른 대본의 배역 — 422 invalid_characters, 행이 남지 않는다")
    void readingSession_aFailedStartLeavesTheOpenSessionAlone() throws Exception {
        String open = startSession(List.of(script.nina)).path("id").textValue();
        jdbc.execute("""
                CREATE OR REPLACE FUNCTION fail_session_insert() RETURNS trigger AS $$
                BEGIN
                    RAISE EXCEPTION 'forced start failure';
                END
                $$ LANGUAGE plpgsql
                """);
        jdbc.execute("""
                CREATE TRIGGER fail_session_insert
                BEFORE INSERT ON reading_sessions
                FOR EACH ROW EXECUTE FUNCTION fail_session_insert()
                """);

        var failed = perform(post("/v2/reading/scripts/{id}/sessions", script.id).contentType(MediaType.APPLICATION_JSON)
                .content(start(UUID.randomUUID(), List.of(script.treplev), "read", script.dialogue(1), script.dialogue(8), "manual", false)
                        .toString()), bearer);

        assertThat(failed.getStatus()).isEqualTo(500);
        assertThat(jdbc.queryForObject("SELECT status FROM reading_sessions WHERE id=?", String.class, UUID.fromString(open)))
                .as("닫으려던 것도 되돌아간다").isEqualTo("in_progress");
        assertThat(count("reading_sessions")).isEqualTo(1);
        jdbc.execute("DROP TRIGGER fail_session_insert ON reading_sessions");

        Script other = saveScript("Bearer " + jwt.issueAccessToken(member()).value());
        for (List<UUID> characters : List.of(List.<UUID>of(), List.of(other.nina), List.of(script.nina, other.nina),
                List.of(script.nina, script.nina), List.of(UUID.randomUUID()))) {
            JsonNode rejected = json(post("/v2/reading/scripts/{id}/sessions", script.id).content(
                    start(UUID.randomUUID(), characters, "read", script.dialogue(1), script.dialogue(8), "manual", false).toString()), 422);
            assertThat(rejected).as(characters.toString()).isEqualTo(mapper.readTree("{\"detail\":\"invalid_characters\"}"));
        }
        assertThat(count("reading_sessions")).isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT status FROM reading_sessions WHERE id=?", String.class, UUID.fromString(open)))
                .isEqualTo("in_progress");
    }

    @Test
    @DisplayName("reading.session: 12번 대사를 지나 13번 저장 응답을 받은 뒤 이어하기 — 상세의 current_line_id 가 13번이고 상세에 \"이어서 연습\"의 재료(구간·위치·시간)가 있다. 나가기 확인 뒤 나감 — in_progress 에 위치·시간 저장")
    void readingSession_progressIsKeptForResuming() throws Exception {
        String session = startSession(List.of(script.nina)).path("id").textValue();

        JsonNode saved = json(patch("/v2/reading/sessions/{id}/progress", session).content(progress(1, script.dialogue(3), 45, null)), 200);

        assertThat(saved).isEqualTo(mapper.readTree("{\"current_line_id\":\"" + script.dialogue(3)
                + "\",\"elapsed_seconds\":45,\"progress_seq\":1,\"status\":\"in_progress\"}"));
        JsonNode detail = json(get("/v2/reading/sessions/{id}", session), 200);
        assertThat(detail.path("status").textValue()).isEqualTo("in_progress");
        assertThat(detail.path("current_line_id").textValue()).isEqualTo(script.dialogue(3).toString());
        assertThat(detail.path("elapsed_seconds").intValue()).isEqualTo(45);
        assertThat(detail.path("progress_seq").longValue()).isEqualTo(1);
        assertThat(detail.path("range").path("start_dialogue_no").intValue()).isEqualTo(1);
        assertThat(detail.path("range").path("end_dialogue_no").intValue()).isEqualTo(8);
        // 대본 상세의 열린 회차와 마지막 회차도 같은 회차다.
        JsonNode scriptDetail = json(get("/v2/reading/scripts/{id}", script.id), 200);
        assertThat(scriptDetail.path("open_session_id").textValue()).isEqualTo(session);
        assertThat(scriptDetail.path("last_session").path("id").textValue()).isEqualTo(session);
    }

    @Test
    @DisplayName("reading.session: progress_seq 7까지 저장된 회차에 seq 5(다른 위치) — 200 이지만 current_line_id 는 그대로다. seq 8에 작은 elapsed — 시간이 줄지 않는다. 시간만 보내면 위치는 그대로다")
    void readingSession_staleSequencesAreIgnoredAndTimeNeverShrinks() throws Exception {
        String session = startSession(List.of(script.nina)).path("id").textValue();
        json(patch("/v2/reading/sessions/{id}/progress", session).content(progress(7, script.dialogue(5), 120, null)), 200);

        JsonNode stale = json(patch("/v2/reading/sessions/{id}/progress", session).content(progress(5, script.dialogue(2), 30, null)), 200);
        assertThat(stale).isEqualTo(mapper.readTree("{\"current_line_id\":\"" + script.dialogue(5)
                + "\",\"elapsed_seconds\":120,\"progress_seq\":7,\"status\":\"in_progress\"}"));
        JsonNode same = json(patch("/v2/reading/sessions/{id}/progress", session).content(progress(7, script.dialogue(2), 30, null)), 200);
        assertThat(same.path("current_line_id").textValue()).as("같은 순번도 무시한다").isEqualTo(script.dialogue(5).toString());

        JsonNode shorter = json(patch("/v2/reading/sessions/{id}/progress", session).content(progress(8, script.dialogue(6), 100, null)), 200);
        assertThat(shorter.path("elapsed_seconds").intValue()).as("시간은 줄지 않는다").isEqualTo(120);
        assertThat(shorter.path("current_line_id").textValue()).isEqualTo(script.dialogue(6).toString());
        assertThat(shorter.path("progress_seq").longValue()).isEqualTo(8);

        JsonNode timeOnly = json(patch("/v2/reading/sessions/{id}/progress", session).content("{\"progress_seq\":9,\"elapsed_seconds\":150}"), 200);
        assertThat(timeOnly.path("current_line_id").textValue()).isEqualTo(script.dialogue(6).toString());
        assertThat(timeOnly.path("elapsed_seconds").intValue()).isEqualTo(150);
    }

    @Test
    @DisplayName("reading.session: 구간 마지막 대사를 넘기고 complete — completed, ended_at 있음, current_line_id NULL. 그 회차에 진행 저장 — 409 session_closed. stopped 회차에 진행 저장 — 409 session_closed")
    void readingSession_completingClosesTheSessionAndClosedSessionsRejectProgress() throws Exception {
        String session = startSession(List.of(script.nina)).path("id").textValue();
        json(patch("/v2/reading/sessions/{id}/progress", session).content(progress(1, script.dialogue(8), 200, null)), 200);
        clock.advance(Duration.ofSeconds(10));

        JsonNode completed = json(patch("/v2/reading/sessions/{id}/progress", session)
                .content("{\"progress_seq\":2,\"elapsed_seconds\":210,\"complete\":true}"), 200);

        assertThat(completed).isEqualTo(mapper.readTree("{\"current_line_id\":null,\"elapsed_seconds\":210,\"progress_seq\":2,\"status\":\"completed\"}"));
        JsonNode detail = json(get("/v2/reading/sessions/{id}", session), 200);
        assertThat(detail.path("status").textValue()).isEqualTo("completed");
        assertThat(Instant.parse(detail.path("ended_at").textValue())).isEqualTo(clock.instant());
        assertThat(detail.path("current_line_id").isNull()).isTrue();
        assertThat(detail.path("range").path("end_dialogue_no").intValue() - detail.path("range").path("start_dialogue_no").intValue() + 1)
                .as("진행 N / N 의 N — 구간 안 대사 줄 수").isEqualTo(8);

        JsonNode closed = json(patch("/v2/reading/sessions/{id}/progress", session).content(progress(3, script.dialogue(2), 300, null)), 409);
        assertThat(closed).isEqualTo(mapper.readTree("{\"detail\":\"session_closed\"}"));
        assertThat(json(get("/v2/reading/sessions/{id}", session), 200).path("progress_seq").longValue()).isEqualTo(2);

        String stopped = startSession(List.of(script.nina)).path("id").textValue();
        startSession(List.of(script.treplev));
        assertThat(jdbc.queryForObject("SELECT status FROM reading_sessions WHERE id=?", String.class, UUID.fromString(stopped)))
                .isEqualTo("stopped");
        assertThat(json(patch("/v2/reading/sessions/{id}/progress", stopped).content(progress(1, script.dialogue(2), 5, null)), 409))
                .isEqualTo(mapper.readTree("{\"detail\":\"session_closed\"}"));
        // 대본 카드 칩 — 열린 회차가 있으면 연습 중.
        assertThat(cardOf(script.id).path("status").textValue()).isEqualTo("reading");
    }

    @Test
    @DisplayName("reading.session: 내 대사 없는 구간으로 시작 — 422 empty_range. 시작 줄이 끝 줄 뒤 — 422 empty_range. 지문·장면·남의 줄 id — 422 invalid_line. 배역이 하나뿐인 대본·모든 배역을 고른 시작은 된다")
    void readingSession_rangesWithoutMyLinesOrOutOfOrderAreRejected() throws Exception {
        // 대사 5·6 은 아르카디나·트레플레프의 것이라 니나의 대사가 없다.
        assertThat(json(post("/v2/reading/scripts/{id}/sessions", script.id).content(
                start(UUID.randomUUID(), List.of(script.nina), "read", script.dialogue(5), script.dialogue(6), "manual", false).toString()), 422))
                .isEqualTo(mapper.readTree("{\"detail\":\"empty_range\"}"));
        assertThat(json(post("/v2/reading/scripts/{id}/sessions", script.id).content(
                start(UUID.randomUUID(), List.of(script.nina), "read", script.dialogue(4), script.dialogue(2), "manual", false).toString()), 422))
                .isEqualTo(mapper.readTree("{\"detail\":\"empty_range\"}"));
        Script other = saveScript("Bearer " + jwt.issueAccessToken(member()).value());
        for (UUID[] range : List.of(
                new UUID[] {script.scene, script.dialogue(8)},
                new UUID[] {script.dialogue(1), script.direction},
                new UUID[] {other.dialogue(1), script.dialogue(8)},
                new UUID[] {script.dialogue(1), UUID.randomUUID()})) {
            assertThat(json(post("/v2/reading/scripts/{id}/sessions", script.id).content(
                    start(UUID.randomUUID(), List.of(script.nina), "read", range[0], range[1], "manual", false).toString()), 422))
                    .as(range[0] + " ~ " + range[1]).isEqualTo(mapper.readTree("{\"detail\":\"invalid_line\"}"));
        }
        assertThat(count("reading_sessions")).isZero();

        JsonNode everyone = startSession(List.of(script.nina, script.treplev, script.arkadina));
        assertThat(everyone.path("my_dialogue_count").intValue()).as("모든 배역이 내 배역이면 내 차례만 이어진다").isEqualTo(8);
        JsonNode partial = json(post("/v2/reading/scripts/{id}/sessions", script.id).content(
                start(UUID.randomUUID(), List.of(script.nina), "quiz", script.dialogue(3), script.dialogue(6), "silence", true).toString()), 201);
        assertThat(partial.path("range").path("start_dialogue_no").intValue()).isEqualTo(3);
        assertThat(partial.path("range").path("end_dialogue_no").intValue()).isEqualTo(6);
        assertThat(partial.path("my_dialogue_count").intValue()).as("3·4 가운데 니나의 것은 3 하나").isEqualTo(1);
        assertThat(partial.path("current_line_id").textValue()).isEqualTo(script.dialogue(3).toString());
    }

    @Test
    @DisplayName("reading.session: quiz 에서 한 줄을 2회 미달 — line_results 에 {unmatched, misses 2}. 첫 미달 뒤 통과 — {passed, misses 1}. 넘어가기 — skipped. 같은 줄은 마지막 사건이 이기고 보내지 않은 줄은 남는다. 구간 밖·지문 줄 — 422 invalid_line")
    void readingSession_lineResultsKeepTheLastEventPerLine() throws Exception {
        String session = json(post("/v2/reading/scripts/{id}/sessions", script.id).content(
                start(UUID.randomUUID(), List.of(script.nina), "quiz", script.dialogue(1), script.dialogue(4), "silence", false).toString()), 201)
                .path("id").textValue();

        json(patch("/v2/reading/sessions/{id}/progress", session).content(progress(1, script.dialogue(2), 10,
                List.of(result(script.dialogue(1), "unmatched", 1)))), 200);
        json(patch("/v2/reading/sessions/{id}/progress", session).content(progress(2, script.dialogue(3), 20,
                List.of(result(script.dialogue(1), "unmatched", 2), result(script.dialogue(2), "passed", 1)))), 200);
        json(patch("/v2/reading/sessions/{id}/progress", session).content(progress(3, script.dialogue(4), 30,
                List.of(result(script.dialogue(3), "skipped", 0)))), 200);

        JsonNode detail = json(get("/v2/reading/sessions/{id}", session), 200);
        assertThat(detail.path("line_results")).hasSize(3);
        assertThat(detail.path("line_results").get(0)).isEqualTo(result(script.dialogue(1), "unmatched", 2));
        assertThat(detail.path("line_results").get(1)).isEqualTo(result(script.dialogue(2), "passed", 1));
        assertThat(detail.path("line_results").get(2)).isEqualTo(result(script.dialogue(3), "skipped", 0));
        assertThat(jdbc.queryForObject("SELECT CAST(line_results AS text) FROM reading_sessions WHERE id=?", String.class, UUID.fromString(session)))
                .contains("\"line_id\"").contains("\"outcome\"").contains("\"misses\"");

        for (UUID line : List.of(script.dialogue(5), script.direction, script.scene, UUID.randomUUID())) {
            JsonNode rejected = json(patch("/v2/reading/sessions/{id}/progress", session).content(progress(4, null, 40,
                    List.of(result(line, "passed", 0)))), 422);
            assertThat(rejected).as(line.toString()).isEqualTo(mapper.readTree("{\"detail\":\"invalid_line\"}"));
        }
        assertThat(json(patch("/v2/reading/sessions/{id}/progress", session).content(progress(4, script.direction, 40, null)), 422))
                .as("위치도 구간 안 대사 줄만").isEqualTo(mapper.readTree("{\"detail\":\"invalid_line\"}"));
        assertThat(json(patch("/v2/reading/sessions/{id}/progress", session).content(progress(4, script.dialogue(5), 40, null)), 422))
                .isEqualTo(mapper.readTree("{\"detail\":\"invalid_line\"}"));
        assertThat(json(get("/v2/reading/sessions/{id}", session), 200).path("progress_seq").longValue())
                .as("거절된 저장은 아무것도 바꾸지 않는다").isEqualTo(3);
        for (String malformed : List.of(
                "{\"current_line_id\":\"" + script.dialogue(2) + "\"}",
                "{\"progress_seq\":-1}",
                "{\"progress_seq\":5,\"elapsed_seconds\":-3}",
                "{\"progress_seq\":5,\"line_results\":[{\"line_id\":\"" + script.dialogue(2) + "\",\"outcome\":\"great\",\"misses\":0}]}",
                "{\"progress_seq\":5,\"review_lines\":[]}")) {
            assertThat(json(patch("/v2/reading/sessions/{id}/progress", session).content(malformed), 422).path("detail").isArray())
                    .as(malformed).isTrue();
        }
    }

    @Test
    @DisplayName("reading.session: 다시 리딩 — 같은 설정의 새 회차가 생기고 이전 회차는 그대로다. 두 번째 회차에서 내 배역을 바꿔도 첫 회차의 my_character_ids 는 그대로다(reading.cast)")
    void readingSession_readingAgainStartsANewSessionAndKeepsTheOldOne() throws Exception {
        String first = startSession(List.of(script.nina, script.treplev)).path("id").textValue();
        json(patch("/v2/reading/sessions/{id}/progress", first).content("{\"progress_seq\":1,\"elapsed_seconds\":90,\"complete\":true}"), 200);

        JsonNode again = startSession(List.of(script.nina, script.treplev));
        JsonNode changed = startSession(List.of(script.arkadina));

        assertThat(again.path("id").textValue()).isNotEqualTo(first);
        assertThat(again.path("my_character_ids")).extracting(JsonNode::textValue)
                .containsExactly(script.nina.toString(), script.treplev.toString());
        JsonNode previous = json(get("/v2/reading/sessions/{id}", first), 200);
        assertThat(previous.path("status").textValue()).isEqualTo("completed");
        assertThat(previous.path("elapsed_seconds").intValue()).isEqualTo(90);
        assertThat(previous.path("my_character_ids")).extracting(JsonNode::textValue)
                .as("첫 회차의 내 배역은 그대로다").containsExactly(script.nina.toString(), script.treplev.toString());
        assertThat(changed.path("my_character_names")).extracting(JsonNode::textValue).containsExactly("아르카디나");
        assertThat(count("reading_sessions")).isEqualTo(3);
    }

    @Test
    @DisplayName("reading.session: 회차 목록 — 최근순이고 항목마다 회차 번호(시작 순)·상태·내 배역·구간 대사 번호·내 대사 수·녹음된 줄 수·걸린 시간·시작·끝 시각이 있다. 남의 대본의 목록은 404")
    void readingSession_listIsNewestFirstWithAggregates() throws Exception {
        String first = startSession(List.of(script.nina)).path("id").textValue();
        json(patch("/v2/reading/sessions/{id}/progress", first).content("{\"progress_seq\":1,\"elapsed_seconds\":60,\"complete\":true}"), 200);
        clock.advance(Duration.ofMinutes(1));
        String second = json(post("/v2/reading/scripts/{id}/sessions", script.id).content(
                start(UUID.randomUUID(), List.of(script.nina, script.treplev), "read", script.dialogue(2), script.dialogue(7), "manual", true).toString()), 201)
                .path("id").textValue();
        recording(member, UUID.fromString(second), script.dialogue(2), "reading/a.m4a");
        recording(member, UUID.fromString(second), script.dialogue(3), "reading/b.m4a");

        JsonNode list = json(get("/v2/reading/scripts/{id}/sessions", script.id), 200);

        assertThat(list.fieldNames()).toIterable().containsExactly("sessions");
        assertThat(list.path("sessions")).extracting(row -> row.path("id").textValue()).containsExactly(second, first);
        JsonNode latest = list.path("sessions").get(0);
        assertThat(latest.fieldNames()).toIterable().containsExactlyInAnyOrder(
                "id", "ordinal", "status", "my_character_ids", "my_character_names", "range", "my_dialogue_count",
                "recorded_line_count", "elapsed_seconds", "started_at", "ended_at");
        assertThat(latest.path("ordinal").intValue()).isEqualTo(2);
        assertThat(latest.path("status").textValue()).isEqualTo("in_progress");
        assertThat(latest.path("my_character_names")).extracting(JsonNode::textValue).containsExactly("니나", "트레플레프");
        assertThat(latest.path("range")).isEqualTo(mapper.readTree("{\"start_dialogue_no\":2,\"end_dialogue_no\":7}"));
        assertThat(latest.path("my_dialogue_count").intValue()).as("2~7 가운데 니나 3·7, 트레플레프 2·6").isEqualTo(4);
        assertThat(latest.path("recorded_line_count").intValue()).isEqualTo(2);
        assertThat(latest.path("ended_at").isNull()).isTrue();
        JsonNode oldest = list.path("sessions").get(1);
        assertThat(oldest.path("ordinal").intValue()).isEqualTo(1);
        assertThat(oldest.path("status").textValue()).isEqualTo("completed");
        assertThat(oldest.path("elapsed_seconds").intValue()).isEqualTo(60);
        assertThat(oldest.path("ended_at").isNull()).isFalse();
        assertThat(json(get("/v2/reading/sessions/{id}", second), 200).path("recordings")).hasSize(2);

        String others = "Bearer " + jwt.issueAccessToken(member()).value();
        var foreign = perform(get("/v2/reading/scripts/{id}/sessions", script.id), others);
        assertThat(foreign.getStatus()).isEqualTo(404);
        assertThat(mapper.readTree(foreign.getContentAsString())).isEqualTo(mapper.readTree("{\"detail\":\"script_not_found\"}"));
        for (MockHttpServletRequestBuilder request : List.of(
                get("/v2/reading/sessions/{id}", second),
                patch("/v2/reading/sessions/{id}/progress", second).contentType(MediaType.APPLICATION_JSON).content("{\"progress_seq\":9}"),
                delete("/v2/reading/sessions/{id}", second))) {
            var response = perform(request, others);
            assertThat(response.getStatus()).isEqualTo(404);
            assertThat(mapper.readTree(response.getContentAsString())).isEqualTo(mapper.readTree("{\"detail\":\"session_not_found\"}"));
        }
        assertThat(perform(post("/v2/reading/scripts/{id}/sessions", script.id).contentType(MediaType.APPLICATION_JSON)
                .content(start(UUID.randomUUID(), List.of(script.nina), "read", script.dialogue(1), script.dialogue(8), "manual", false).toString()),
                others).getStatus()).as("남의 대본에 회차 시작").isEqualTo(404);
    }

    @Test
    @DisplayName("reading.session: 회차 삭제 — 그 회차의 reading_recordings 행과 객체가 없고 line_memorization 행은 남는다. 지운 회차에 진행 저장·조회 — 404. 대본이 지워진 뒤 회차 조회 — 404")
    void readingSession_deletingRemovesRecordingsButKeepsMemorization() throws Exception {
        UUID session = UUID.fromString(startSession(List.of(script.nina)).path("id").textValue());
        recording(member, session, script.dialogue(1), "reading/x.m4a");
        jdbc.update("INSERT INTO line_memorization(id,user_id,line_id,status) VALUES (?,?,?,'memorized')",
                UUID.randomUUID(), member, script.dialogue(1));
        UUID kept = UUID.fromString(startSession(List.of(script.treplev)).path("id").textValue());

        assertThat(perform(delete("/v2/reading/sessions/{id}", session), bearer).getStatus()).isEqualTo(204);

        assertThat(count("reading_recordings")).isZero();
        assertThat(storage.objects).as("녹음 객체도 지운다").isEmpty();
        assertThat(count("line_memorization")).as("암기 상태는 남는다").isEqualTo(1);
        assertThat(count("reading_sessions")).isEqualTo(1);
        assertThat(count("account_cleanup_operations")).isZero();
        assertThat(perform(get("/v2/reading/sessions/{id}", session), bearer).getStatus()).isEqualTo(404);
        var late = perform(patch("/v2/reading/sessions/{id}/progress", session).contentType(MediaType.APPLICATION_JSON)
                .content(progress(1, script.dialogue(2), 5, null)), bearer);
        assertThat(late.getStatus()).isEqualTo(404);
        assertThat(mapper.readTree(late.getContentAsString())).isEqualTo(mapper.readTree("{\"detail\":\"session_not_found\"}"));
        assertThat(perform(delete("/v2/reading/sessions/{id}", session), bearer).getStatus()).as("두 번째는 404").isEqualTo(404);

        assertThat(perform(delete("/v2/reading/scripts/{id}", script.id), bearer).getStatus()).isEqualTo(204);
        assertThat(perform(get("/v2/reading/sessions/{id}", kept), bearer).getStatus()).as("대본이 지워진 뒤 회차 조회").isEqualTo(404);
        assertThat(count("reading_sessions")).isZero();
    }

    @Test
    @DisplayName("reading.session·reading.script: 대본 카드 칩 — 열린 회차가 있으면 연습 중, 마지막 회차가 completed 면 연습 완료, stopped 만 남으면 배역 선택. 내 배역은 마지막 회차의 것이다")
    void readingSession_scriptCardsFollowTheLastSession() throws Exception {
        assertThat(cardOf(script.id).path("status").textValue()).isEqualTo("no_cast");

        String first = startSession(List.of(script.nina)).path("id").textValue();
        JsonNode reading = cardOf(script.id);
        assertThat(reading.path("status").textValue()).isEqualTo("reading");
        assertThat(reading.path("my_character_names")).extracting(JsonNode::textValue).containsExactly("니나");
        assertThat(json(get("/v2/reading/scripts"), 200).path("in_progress_count").intValue()).isEqualTo(1);

        json(patch("/v2/reading/sessions/{id}/progress", first).content("{\"progress_seq\":1,\"elapsed_seconds\":1,\"complete\":true}"), 200);
        assertThat(cardOf(script.id).path("status").textValue()).isEqualTo("completed");

        clock.advance(Duration.ofSeconds(1));
        String second = startSession(List.of(script.treplev)).path("id").textValue();
        clock.advance(Duration.ofSeconds(1));
        startSession(List.of(script.arkadina));
        assertThat(perform(delete("/v2/reading/sessions/{id}", jdbc.queryForObject(
                "SELECT id FROM reading_sessions WHERE status='in_progress'", UUID.class)), bearer).getStatus()).isEqualTo(204);
        JsonNode stoppedOnly = cardOf(script.id);
        assertThat(stoppedOnly.path("status").textValue()).as("마지막 회차가 stopped 면 배역 선택").isEqualTo("no_cast");
        assertThat(stoppedOnly.path("my_character_names")).extracting(JsonNode::textValue)
                .as("내 배역은 마지막 회차(stopped)의 것").containsExactly("트레플레프");
        assertThat(jdbc.queryForObject("SELECT status FROM reading_sessions WHERE id=?", String.class, UUID.fromString(second)))
                .isEqualTo("stopped");
    }

    @Test
    @DisplayName("account.guest·reading.session: 웹 게스트가 회차를 중간까지 하고 앱으로 옮김 — 회원의 상세에 그 회차가 in_progress 로 같은 줄부터 보이고, 옮긴 게스트의 토큰은 guest_transferred 다")
    void readingSession_aGuestSessionMovesToTheMemberWithItsPosition() throws Exception {
        Guest guest = consentedGuest();
        Script guests = saveScript(guest.bearer());
        var started = perform(post("/v2/reading/scripts/{id}/sessions", guests.id).contentType(MediaType.APPLICATION_JSON)
                .content(start(UUID.randomUUID(), List.of(guests.nina), "read", guests.dialogue(1), guests.dialogue(8), "silence", true).toString()),
                guest.bearer());
        assertThat(started.getStatus()).as(started.getContentAsString()).isEqualTo(201);
        String session = mapper.readTree(started.getContentAsString()).path("id").textValue();
        assertThat(perform(patch("/v2/reading/sessions/{id}/progress", session).contentType(MediaType.APPLICATION_JSON)
                .content(progress(3, guests.dialogue(4), 77, List.of(result(guests.dialogue(1), "unmatched", 1)))), guest.bearer()).getStatus())
                .isEqualTo(200);

        transfer(guest);

        JsonNode detail = json(get("/v2/reading/sessions/{id}", session), 200);
        assertThat(detail.path("status").textValue()).isEqualTo("in_progress");
        assertThat(detail.path("current_line_id").textValue()).isEqualTo(guests.dialogue(4).toString());
        assertThat(detail.path("elapsed_seconds").intValue()).isEqualTo(77);
        assertThat(detail.path("line_results")).hasSize(1);
        assertThat(json(get("/v2/reading/scripts/{id}", guests.id), 200).path("open_session_id").textValue()).isEqualTo(session);
        assertThat(json(get("/v2/reading/scripts/{id}/sessions", guests.id), 200).path("sessions")).hasSize(1);
        assertThat(json(patch("/v2/reading/sessions/{id}/progress", session).content(progress(4, guests.dialogue(5), 80, null)), 200)
                .path("current_line_id").textValue()).as("회원이 이어서 저장한다").isEqualTo(guests.dialogue(5).toString());
        var stale = perform(get("/v2/reading/sessions/{id}", session), guest.bearer());
        assertThat(stale.getStatus()).isEqualTo(403);
        assertThat(mapper.readTree(stale.getContentAsString())).isEqualTo(mapper.readTree("{\"detail\":\"guest_transferred\"}"));
    }

    @Test
    @DisplayName("reading.session: 이관이 먼저 끝난 뒤 도착한 진행 저장 — 404 이고 옛 계정에 아무것도 남지 않는다(이관이 잡은 행 뒤에 줄을 서고 남의 것을 본다)")
    void readingSession_aSaveArrivingDuringTheTransferIsNotFoundAfterwards() throws Exception {
        Guest guest = consentedGuest();
        Script guests = saveScript(guest.bearer());
        var started = perform(post("/v2/reading/scripts/{id}/sessions", guests.id).contentType(MediaType.APPLICATION_JSON)
                .content(start(UUID.randomUUID(), List.of(guests.nina), "read", guests.dialogue(1), guests.dialogue(8), "manual", false).toString()),
                guest.bearer());
        String session = mapper.readTree(started.getContentAsString()).path("id").textValue();
        String code = issueCode(guest);
        holdSessionReassignments();
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try (Connection gate = outsideConnection()) {
            try (Statement statement = gate.createStatement()) {
                statement.execute("SELECT pg_advisory_lock(" + TRANSFER_GATE + ")");
            }
            // 이관: 회차 행을 잡은 채 주인을 바꾸려다 문 앞에서 멈춘다.
            Future<Integer> transferring = pool.submit(() -> transferStatus(code));
            awaitUntil("이관이 문 앞에 서기", 1, this::lockWaiters);
            // 그 사이 옛 게스트 토큰의 진행 저장: 게이트는 지나지만 회차 행에서 줄을 선다.
            Future<MockHttpServletResponse> saving = pool.submit(() -> perform(
                    patch("/v2/reading/sessions/{id}/progress", session).contentType(MediaType.APPLICATION_JSON)
                            .content(progress(1, guests.dialogue(2), 9, null)), guest.bearer()));
            awaitUntil("저장이 회차 행에서 줄을 서기", 2, this::lockWaiters);
            try (Statement statement = gate.createStatement()) {
                statement.execute("SELECT pg_advisory_unlock(" + TRANSFER_GATE + ")");
            }

            assertThat(transferring.get()).isEqualTo(200);
            MockHttpServletResponse late = saving.get();
            assertThat(late.getStatus()).as(late.getContentAsString()).isEqualTo(404);
            assertThat(mapper.readTree(late.getContentAsString())).isEqualTo(mapper.readTree("{\"detail\":\"session_not_found\"}"));
        } finally {
            pool.shutdownNow();
        }
        JsonNode detail = json(get("/v2/reading/sessions/{id}", session), 200);
        assertThat(detail.path("progress_seq").longValue()).as("늦은 저장은 반영되지 않았다").isZero();
        assertThat(detail.path("current_line_id").textValue()).isEqualTo(guests.dialogue(1).toString());
        assertThat(jdbc.queryForObject("SELECT count(*) FROM reading_sessions WHERE user_id=?", Integer.class, guest.id())).isZero();
    }

    @Test
    @DisplayName("reading.session: 요청 id 는 본문과 X-Request-Id 헤더에 같은 값으로 온다 — 다르면 422 배열이고 헤더가 없어도 된다. 본문의 모양이 틀리면 422 배열")
    void readingSession_theRequestIdHeaderMustMatchTheBodyAndMalformedBodiesAreValidationErrors() throws Exception {
        UUID requestId = UUID.randomUUID();
        ObjectNode body = start(requestId, List.of(script.nina), "read", script.dialogue(1), script.dialogue(8), "manual", false);

        assertThat(json(post("/v2/reading/scripts/{id}/sessions", script.id).header("X-Request-Id", requestId.toString())
                .content(body.toString()), 201).path("id").textValue()).isNotBlank();
        JsonNode rejected = json(post("/v2/reading/scripts/{id}/sessions", script.id).header("X-Request-Id", UUID.randomUUID().toString())
                .content(body.toString()), 422);
        assertThat(rejected.path("detail").isArray()).isTrue();
        assertThat(rejected.path("detail").get(0).path("loc")).extracting(JsonNode::asText).containsExactly("header", "X-Request-Id");

        for (ObjectNode malformed : List.of(
                start(UUID.randomUUID(), List.of(script.nina), "listen", script.dialogue(1), script.dialogue(8), "manual", false),
                start(UUID.randomUUID(), List.of(script.nina), "read", script.dialogue(1), script.dialogue(8), "auto", false),
                start(UUID.randomUUID(), List.of(script.nina), "read", script.dialogue(1), script.dialogue(8), "manual", null))) {
            assertThat(json(post("/v2/reading/scripts/{id}/sessions", script.id).content(malformed.toString()), 422).path("detail").isArray())
                    .as(malformed.toString()).isTrue();
        }
        ObjectNode missing = start(UUID.randomUUID(), List.of(script.nina), "read", script.dialogue(1), script.dialogue(8), "manual", false);
        missing.remove("start_line_id");
        assertThat(json(post("/v2/reading/scripts/{id}/sessions", script.id).content(missing.toString()), 422).path("detail").isArray()).isTrue();
        ObjectNode unknown = start(UUID.randomUUID(), List.of(script.nina), "read", script.dialogue(1), script.dialogue(8), "manual", false);
        unknown.put("hide_mode", "mine");
        assertThat(json(post("/v2/reading/scripts/{id}/sessions", script.id).content(unknown.toString()), 422).path("detail").isArray())
                .as("가리기는 서버에 없다").isTrue();
        assertThat(count("reading_sessions")).isEqualTo(1);
    }

    // ---- helpers ----

    /** 저장된 대본과 그 줄·배역의 id. {@code dialogue(n)} 은 n 번 대사의 줄 id 다. */
    private record Script(UUID id, UUID nina, UUID treplev, UUID arkadina, UUID scene, UUID direction, List<UUID> dialogues) {
        UUID dialogue(int no) {
            return dialogues.get(no - 1);
        }
    }

    /**
     * 콜론 형식 대본 — 장면 하나, 지문 하나, 대사 여덟(니나 4·트레플레프 2·아르카디나 2). 대사 번호와 배역:
     * 1 니나 · 2 트레플레프 · 3 니나 · 4 아르카디나 · 5 아르카디나 · 6 트레플레프 · 7 니나 · 8 니나.
     */
    private Script saveScript(String authorization) throws Exception {
        ObjectNode body = mapper.createObjectNode();
        body.put("request_id", UUID.randomUUID().toString());
        body.put("title", "갈매기");
        body.put("source", "paste");
        body.put("raw_text", "원문");
        ArrayNode characters = body.putArray("characters");
        for (String name : List.of("니나", "트레플레프", "아르카디나")) {
            characters.addObject().put("name", name);
        }
        ArrayNode lines = body.putArray("lines");
        int[] speakers = {0, 1, 0, 2, 2, 1, 0, 0};
        lines.addObject().put("ordinal", 1).put("kind", "scene").putNull("character_index").put("text", "제1막");
        lines.addObject().put("ordinal", 2).put("kind", "direction").putNull("character_index").put("text", "(호숫가)");
        for (int index = 0; index < speakers.length; index++) {
            lines.addObject().put("ordinal", index + 3).put("kind", "dialogue").put("character_index", speakers[index])
                    .put("text", "대사 " + (index + 1));
        }
        var response = perform(post("/v2/reading/scripts").contentType(MediaType.APPLICATION_JSON).content(body.toString()), authorization);
        assertThat(response.getStatus()).as(response.getContentAsString()).isEqualTo(201);
        JsonNode saved = mapper.readTree(response.getContentAsString());
        List<UUID> dialogues = new ArrayList<>();
        for (JsonNode line : saved.path("lines")) {
            if ("dialogue".equals(line.path("kind").textValue())) {
                dialogues.add(UUID.fromString(line.path("id").textValue()));
            }
        }
        return new Script(
                UUID.fromString(saved.path("id").textValue()),
                UUID.fromString(saved.path("characters").get(0).path("id").textValue()),
                UUID.fromString(saved.path("characters").get(1).path("id").textValue()),
                UUID.fromString(saved.path("characters").get(2).path("id").textValue()),
                UUID.fromString(saved.path("lines").get(0).path("id").textValue()),
                UUID.fromString(saved.path("lines").get(1).path("id").textValue()),
                dialogues);
    }

    private ObjectNode start(
            UUID requestId, List<UUID> characters, String mode, UUID startLine, UUID endLine, String advance, Boolean record) {
        ObjectNode body = mapper.createObjectNode();
        body.put("request_id", requestId.toString());
        ArrayNode ids = body.putArray("my_character_ids");
        characters.forEach(id -> ids.add(id.toString()));
        body.put("mode", mode);
        body.put("start_line_id", startLine.toString());
        body.put("end_line_id", endLine.toString());
        body.put("advance", advance);
        if (record == null) {
            body.putNull("record");
        } else {
            body.put("record", record);
        }
        return body;
    }

    /** 이 테스트의 회원이 전체 구간·읽어주기·침묵 감지·녹음 켬으로 시작한다. */
    private JsonNode startSession(List<UUID> characters) throws Exception {
        return json(post("/v2/reading/scripts/{id}/sessions", script.id).content(
                start(UUID.randomUUID(), characters, "read", script.dialogue(1), script.dialogue(8), "silence", true).toString()), 201);
    }

    private int startStatus(List<UUID> characters) throws Exception {
        return perform(post("/v2/reading/scripts/{id}/sessions", script.id).contentType(MediaType.APPLICATION_JSON).content(
                start(UUID.randomUUID(), characters, "read", script.dialogue(1), script.dialogue(8), "silence", true).toString()), bearer)
                .getStatus();
    }

    private String progress(long seq, UUID currentLine, Integer elapsed, List<ObjectNode> results) {
        ObjectNode body = mapper.createObjectNode();
        body.put("progress_seq", seq);
        if (currentLine != null) {
            body.put("current_line_id", currentLine.toString());
        }
        if (elapsed != null) {
            body.put("elapsed_seconds", elapsed);
        }
        if (results != null) {
            body.set("line_results", mapper.valueToTree(results));
        }
        return body.toString();
    }

    private ObjectNode result(UUID line, String outcome, int misses) {
        return mapper.createObjectNode().put("line_id", line.toString()).put("outcome", outcome).put("misses", misses);
    }

    private JsonNode cardOf(UUID scriptId) throws Exception {
        for (JsonNode card : json(get("/v2/reading/scripts"), 200).path("scripts")) {
            if (scriptId.toString().equals(card.path("id").textValue())) {
                return card;
            }
        }
        throw new AssertionError("no card for " + scriptId);
    }

    private int openSessions() {
        return jdbc.queryForObject("SELECT count(*) FROM reading_sessions WHERE status='in_progress'", Integer.class);
    }

    private UUID member() {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO users(id,status) VALUES (?,'active')", id);
        jdbc.update("INSERT INTO user_identities(id,user_id,provider,provider_uid) VALUES (?,?,'google',?)",
                UUID.randomUUID(), id, "g-" + id);
        AccountFixtures.passGate(jdbc, id);
        return id;
    }

    private record Guest(UUID id, String bearer) {
    }

    /** 리딩의 문서 둘에 동의한 웹 게스트. */
    private Guest consentedGuest() throws Exception {
        var response = mvc.perform(post("/v2/auth/guest").with(request -> {
            request.setRemoteAddr("10.49." + ADDRESSES.incrementAndGet() + ".1");
            return request;
        })).andReturn().getResponse();
        assertThat(response.getStatus()).isEqualTo(201);
        JsonNode body = mapper.readTree(response.getContentAsString());
        Guest guest = new Guest(
                UUID.fromString(body.path("user").path("id").textValue()),
                "Bearer " + body.path("access_token").textValue());
        consent(guest, "terms", true);
        consent(guest, "privacy", null);
        return guest;
    }

    private void consent(Guest guest, String type, Boolean ageConfirmed) throws Exception {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("document_id", documents.get(type).toString());
        body.put("action", "granted");
        if (ageConfirmed != null) {
            body.put("age_confirmed", ageConfirmed);
        }
        var response = perform(post("/v2/consents").contentType(MediaType.APPLICATION_JSON)
                .content(mapper.writeValueAsString(body)), guest.bearer());
        assertThat(response.getStatus()).as(response.getContentAsString()).isEqualTo(201);
    }

    private String issueCode(Guest guest) throws Exception {
        var response = perform(post("/v2/guest/transfer-code"), guest.bearer());
        assertThat(response.getStatus()).as(response.getContentAsString()).isEqualTo(201);
        return mapper.readTree(response.getContentAsString()).path("code").textValue();
    }

    private void transfer(Guest guest) throws Exception {
        assertThat(transferStatus(issueCode(guest))).isEqualTo(200);
    }

    private int transferStatus(String code) throws Exception {
        String from = address;
        return mvc.perform(post("/v2/guest-transfers")
                        .with(request -> {
                            request.setRemoteAddr(from);
                            return request;
                        })
                        .header("Authorization", bearer)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"code\":\"" + code + "\"}"))
                .andReturn().getResponse().getStatus();
    }

    private void recording(UUID owner, UUID session, UUID line, String objectKey) {
        jdbc.update("""
                INSERT INTO reading_recordings(id,user_id,reading_session_id,line_id,request_id,attempt_no,object_key,
                                               content_type,byte_size,duration_ms,transcript_source)
                VALUES (?,?,?,?,?,1,?,'audio/mp4',1000,1500,'none')
                """, UUID.randomUUID(), owner, session, line, UUID.randomUUID(), objectKey);
        storage.objects.put(objectKey, 1000L);
    }

    private Connection outsideConnection() throws Exception {
        return DriverManager.getConnection(PostgresContainerSupport.jdbcUrlFor(database),
                PostgresContainerSupport.POSTGRES.getUsername(), PostgresContainerSupport.POSTGRES.getPassword());
    }

    /** 새 회차의 INSERT 가 문(advisory lock) 앞에서 멈추게 한다 — 실행 순서만 제어하고 결과는 공개 계약에서 본다. */
    private void holdSessionInserts() {
        jdbc.execute("""
                CREATE OR REPLACE FUNCTION hold_session_insert() RETURNS trigger AS $$
                BEGIN
                    PERFORM pg_advisory_xact_lock_shared(%d);
                    RETURN NEW;
                END
                $$ LANGUAGE plpgsql
                """.formatted(START_GATE));
        jdbc.execute("""
                CREATE TRIGGER hold_session_insert
                BEFORE INSERT ON reading_sessions
                FOR EACH ROW EXECUTE FUNCTION hold_session_insert()
                """);
    }

    /** 이관이 회차의 주인을 바꾸는 문장이 문 앞에서 멈추게 한다. 행 잠금은 이미 잡힌 뒤다. */
    private void holdSessionReassignments() {
        jdbc.execute("""
                CREATE OR REPLACE FUNCTION hold_session_reassign() RETURNS trigger AS $$
                BEGIN
                    IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
                        PERFORM pg_advisory_xact_lock_shared(%d);
                    END IF;
                    RETURN NEW;
                END
                $$ LANGUAGE plpgsql
                """.formatted(TRANSFER_GATE));
        jdbc.execute("""
                CREATE TRIGGER hold_session_reassign
                BEFORE UPDATE ON reading_sessions
                FOR EACH ROW EXECUTE FUNCTION hold_session_reassign()
                """);
    }

    private int lockWaiters() {
        return jdbc.queryForObject("""
                SELECT count(*) FROM pg_stat_activity
                WHERE datname=current_database() AND wait_event_type='Lock'
                """, Integer.class);
    }

    private void awaitUntil(String what, int expected, IntSupplier observed) throws Exception {
        Instant deadline = Instant.now().plusSeconds(20);
        while (Instant.now().isBefore(deadline)) {
            if (observed.getAsInt() >= expected) {
                return;
            }
            Thread.sleep(10);
        }
        throw new AssertionError("timed out: " + what + " (saw " + observed.getAsInt() + " of " + expected + ")");
    }

    private MockHttpServletResponse perform(MockHttpServletRequestBuilder request, String authorization) throws Exception {
        return mvc.perform(request.header("Authorization", authorization)).andReturn().getResponse();
    }

    private JsonNode json(MockHttpServletRequestBuilder request, int status) throws Exception {
        var response = perform(request.contentType(MediaType.APPLICATION_JSON), bearer);
        assertThat(response.getStatus()).as(response.getContentAsString()).isEqualTo(status);
        String body = response.getContentAsString();
        return body.isEmpty() ? mapper.nullNode() : mapper.readTree(body);
    }

    private int count(String table) {
        return jdbc.queryForObject("SELECT count(*) FROM " + table, Integer.class);
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
        final Set<String> failing = ConcurrentHashMap.newKeySet();

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
            return size == null ? null : new StoredObjectMetadata(size, "audio/mp4", "etag");
        }

        @Override
        public StoredObjectMetadata downloadToPath(String objectKey, Path destination) {
            throw new UnsupportedOperationException();
        }

        @Override
        public void delete(String objectKey) {
            if (failing.contains(objectKey)) {
                throw new IllegalStateException("storage refused the delete");
            }
            objects.remove(objectKey);
        }
    }
}
