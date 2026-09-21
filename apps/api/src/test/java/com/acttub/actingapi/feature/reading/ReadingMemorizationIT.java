package com.acttub.actingapi.feature.reading;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;

import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;

import com.acttub.actingapi.feature.auth.app.JwtService;
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
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

/**
 * reading.memorization 의 "검증 방법" 가운데 서버가 맡는 항목을 HTTP 와 실제 Postgres 로 본다.
 *
 * <p>여기서 보지 못하는 것(화면·실기기): 암기 화면의 대상 계산·머리 문구·"외운 대사도 보기"·네 모드의 가림·듣고 따라 하기·
 * STT 대조와 유사도 문턱·오프라인 보관 뒤 재전송(서버는 마지막 요청만 본다). 탈퇴 때 행째 지우는 것은 RA5(탈퇴) 몫이다.
 */
@SpringBootTest(properties = {
    "JWT_SECRET=test-secret",
    "ACCOUNT_CLEANUP_ENABLED=false",
    "ACCOUNT_HOUSEKEEPING_ENABLED=false"
})
@AutoConfigureMockMvc
@Import(MutableClock.Fixture.class)
class ReadingMemorizationIT {
    private static final AtomicInteger ADDRESSES = new AtomicInteger();
    private static final OffsetDateTime PUBLISHED = OffsetDateTime.of(2026, 10, 1, 0, 0, 0, 0, ZoneOffset.UTC);

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        String name = PostgresContainerSupport.createDatabaseName("reading_memorization");
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

    private final Map<String, UUID> documents = new LinkedHashMap<>();
    private UUID member;
    private String bearer;
    private String address;
    private Script script;

    @BeforeEach
    void setUp() throws Exception {
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
        clock.set(Instant.now().truncatedTo(java.time.temporal.ChronoUnit.SECONDS));
        address = "10.52.0." + ADDRESSES.incrementAndGet();
        member = member();
        bearer = "Bearer " + jwt.issueAccessToken(member).value();
        script = saveScript(bearer);
    }

    @Test
    @DisplayName("reading.memorization: 줄 하나를 \"이 대사 외웠어요\" — line_memorization 1행, status memorized. \"아직 헷갈려요\" — not_yet. 같은 상태 다시 — updated_at 그대로")
    void readingMemorization_oneRowPerLineAndResendingTheSameStatusKeepsUpdatedAt() throws Exception {
        Instant first = clock.instant();

        JsonNode memorized = mark(bearer, script.dialogue(1), "memorized", 200);

        assertThat(memorized.fieldNames()).toIterable().containsExactlyInAnyOrder("line_id", "status", "updated_at");
        assertThat(memorized.path("line_id").textValue()).isEqualTo(script.dialogue(1).toString());
        assertThat(memorized.path("status").textValue()).isEqualTo("memorized");
        assertThat(Instant.parse(memorized.path("updated_at").textValue())).isEqualTo(first);
        assertThat(count("line_memorization")).isEqualTo(1);
        assertThat(jdbc.queryForMap("SELECT user_id,line_id,status FROM line_memorization"))
                .containsEntry("user_id", member).containsEntry("line_id", script.dialogue(1)).containsEntry("status", "memorized");

        clock.advance(Duration.ofMinutes(1));
        JsonNode notYet = mark(bearer, script.dialogue(1), "not_yet", 200);
        assertThat(notYet.path("status").textValue()).isEqualTo("not_yet");
        assertThat(Instant.parse(notYet.path("updated_at").textValue())).as("상태가 바뀌면 갱신 시각도").isEqualTo(clock.instant());
        assertThat(count("line_memorization")).as("줄마다 행 하나").isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT status FROM line_memorization", String.class)).isEqualTo("not_yet");

        Instant changed = clock.instant();
        clock.advance(Duration.ofMinutes(1));
        JsonNode again = mark(bearer, script.dialogue(1), "not_yet", 200);
        assertThat(again.path("status").textValue()).isEqualTo("not_yet");
        assertThat(Instant.parse(again.path("updated_at").textValue())).as("같은 상태 재전송").isEqualTo(changed);
        assertThat(jdbc.queryForObject("SELECT updated_at FROM line_memorization", OffsetDateTime.class).toInstant()).isEqualTo(changed);
        assertThat(count("line_memorization")).isEqualTo(1);
    }

    @Test
    @DisplayName("reading.memorization: 대본 단위 조회 — 셋을 표시하면 그 대본의 행 셋이 줄 순서로 오고 다른 대본의 표시는 섞이지 않는다. 표시 없는 대본은 빈 배열, 남의 대본·없는 대본은 404 script_not_found")
    void readingMemorization_listsTheScriptsRowsInLineOrder() throws Exception {
        assertThat(list(bearer, script.id, 200)).as("아직 표시가 없다").isEmpty();
        Script other = saveScript(bearer);
        mark(bearer, script.dialogue(7), "memorized", 200);
        mark(bearer, script.dialogue(1), "not_yet", 200);
        mark(bearer, script.dialogue(3), "memorized", 200);
        mark(bearer, other.dialogue(2), "memorized", 200);

        JsonNode rows = list(bearer, script.id, 200);

        assertThat(rows).hasSize(3);
        assertThat(rows).extracting(row -> row.path("line_id").textValue()).as("줄 순서")
                .containsExactly(script.dialogue(1).toString(), script.dialogue(3).toString(), script.dialogue(7).toString());
        assertThat(rows).extracting(row -> row.path("status").textValue()).containsExactly("not_yet", "memorized", "memorized");
        assertThat(rows.get(0).fieldNames()).toIterable().containsExactlyInAnyOrder("line_id", "status", "updated_at");
        assertThat(Instant.parse(rows.get(0).path("updated_at").textValue())).isEqualTo(clock.instant());
        assertThat(list(bearer, other.id, 200)).extracting(row -> row.path("line_id").textValue())
                .containsExactly(other.dialogue(2).toString());

        String others = "Bearer " + jwt.issueAccessToken(member()).value();
        assertThat(list(others, script.id, 404)).as("남의 대본").isEqualTo(mapper.readTree("{\"detail\":\"script_not_found\"}"));
        assertThat(list(bearer, UUID.randomUUID(), 404)).as("없는 대본").isEqualTo(mapper.readTree("{\"detail\":\"script_not_found\"}"));
    }

    @Test
    @DisplayName("reading.memorization: quiz 회차에서 통과한 줄 — line_memorization 은 바뀌지 않는다(행이 없으면 없는 채로, 있으면 그대로)")
    void readingMemorization_quizPassesDoNotTouchTheMarks() throws Exception {
        mark(bearer, script.dialogue(3), "not_yet", 200);
        UUID quiz = startSession(bearer, script, List.of(script.nina), "quiz", script.dialogue(1), script.dialogue(8));
        clock.advance(Duration.ofMinutes(1));

        json(patch("/v2/reading/sessions/{id}/progress", quiz).content("{\"progress_seq\":1,\"current_line_id\":\"" + script.dialogue(7)
                + "\",\"line_results\":[" + result(script.dialogue(1), "passed", 0) + "," + result(script.dialogue(3), "passed", 1) + "]}"), 200);
        json(patch("/v2/reading/sessions/{id}/progress", quiz).content("{\"progress_seq\":2,\"current_line_id\":null,\"complete\":true}"), 200);

        assertThat(count("line_memorization")).as("통과한 줄이 행을 만들지 않는다").isEqualTo(1);
        JsonNode rows = list(bearer, script.id, 200);
        assertThat(rows).hasSize(1);
        assertThat(rows.get(0).path("line_id").textValue()).isEqualTo(script.dialogue(3).toString());
        assertThat(rows.get(0).path("status").textValue()).as("통과해도 not_yet 그대로").isEqualTo("not_yet");
        assertThat(Instant.parse(rows.get(0).path("updated_at").textValue())).isEqualTo(clock.instant().minus(Duration.ofMinutes(1)));
        assertThat(json(get("/v2/reading/sessions/{id}", quiz), 200).path("line_results")).hasSize(2);
    }

    @Test
    @DisplayName("account.guest·reading.memorization: 웹 게스트가 셋을 \"외웠어요\"로 표시하고 앱으로 옮김 — 회원의 조회에 그 셋이 memorized 로 있고 user_id 가 회원이다")
    void readingMemorization_marksMoveWithTheGuest() throws Exception {
        Guest guest = consentedGuest();
        Script guests = saveScript(guest.bearer());
        for (int no : List.of(1, 3, 7)) {
            mark(guest.bearer(), guests.dialogue(no), "memorized", 200);
        }
        assertThat(list(bearer, guests.id, 404)).as("이관 전에는 남의 대본").isEqualTo(mapper.readTree("{\"detail\":\"script_not_found\"}"));

        transfer(guest);

        JsonNode rows = list(bearer, guests.id, 200);
        assertThat(rows).extracting(row -> row.path("line_id").textValue())
                .containsExactly(guests.dialogue(1).toString(), guests.dialogue(3).toString(), guests.dialogue(7).toString());
        assertThat(rows).extracting(row -> row.path("status").textValue()).containsOnly("memorized");
        assertThat(jdbc.queryForList("SELECT user_id FROM line_memorization", UUID.class)).hasSize(3).containsOnly(member);
        assertThat(mark(bearer, guests.dialogue(8), "not_yet", 200).path("status").textValue()).as("옮긴 대본에 회원이 이어서 표시").isEqualTo("not_yet");
        assertThat(mark(guest.bearer(), guests.dialogue(1), "not_yet", 403)).as("닫힌 게스트의 늦은 갱신은 게이트가 막는다")
                .isEqualTo(mapper.readTree("{\"detail\":\"guest_transferred\"}"));
        assertThat(jdbc.queryForObject("SELECT status FROM line_memorization WHERE line_id=?", String.class, guests.dialogue(1)))
                .isEqualTo("memorized");
    }

    @Test
    @DisplayName("reading.memorization: 회차 삭제 뒤 — line_memorization 행은 남는다. 대본 삭제 뒤 — 없다")
    void readingMemorization_survivesSessionDeleteAndGoesWithTheScript() throws Exception {
        UUID session = startSession(bearer, script, List.of(script.nina), "read", script.dialogue(1), script.dialogue(8));
        mark(bearer, script.dialogue(1), "memorized", 200);
        mark(bearer, script.dialogue(3), "not_yet", 200);
        Script other = saveScript(bearer);
        mark(bearer, other.dialogue(1), "memorized", 200);

        assertThat(perform(delete("/v2/reading/sessions/{id}", session), bearer).getStatus()).isEqualTo(204);

        assertThat(count("reading_sessions")).isZero();
        assertThat(list(bearer, script.id, 200)).as("회차를 지워도 남는다").hasSize(2);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM line_memorization WHERE user_id=?", Integer.class, member)).isEqualTo(3);

        assertThat(perform(delete("/v2/reading/scripts/{id}", script.id), bearer).getStatus()).isEqualTo(204);

        assertThat(jdbc.queryForList("SELECT line_id FROM line_memorization", UUID.class)).as("대본과 함께 지운다")
                .containsExactly(other.dialogue(1));
        assertThat(list(bearer, script.id, 404)).isEqualTo(mapper.readTree("{\"detail\":\"script_not_found\"}"));
        assertThat(mark(bearer, script.dialogue(1), "memorized", 404)).as("지운 대본의 줄에 늦은 갱신")
                .isEqualTo(mapper.readTree("{\"detail\":\"line_not_found\"}"));
        assertThat(count("line_memorization")).isEqualTo(1);
    }

    @Test
    @DisplayName("reading.memorization: 지문 줄 id 로 갱신 — 422 invalid_line. 장면 줄 id — 422 invalid_line. 상대역 대사 줄 id — 200. 남의 줄 id — 404. 없는 줄 id — 404")
    void readingMemorization_onlyDialogueLinesOfMyOwnScript() throws Exception {
        assertThat(mark(bearer, script.direction, "memorized", 422)).isEqualTo(mapper.readTree("{\"detail\":\"invalid_line\"}"));
        assertThat(mark(bearer, script.scene, "memorized", 422)).isEqualTo(mapper.readTree("{\"detail\":\"invalid_line\"}"));
        assertThat(count("line_memorization")).isZero();

        // 니나로 회차를 연 뒤에도 트레플레프(상대역)의 대사 줄은 받는다 — 배역은 기기가 고른다.
        startSession(bearer, script, List.of(script.nina), "read", script.dialogue(1), script.dialogue(8));
        JsonNode opponent = mark(bearer, script.dialogue(2), "memorized", 200);
        assertThat(opponent.path("line_id").textValue()).isEqualTo(script.dialogue(2).toString());
        assertThat(count("line_memorization")).isEqualTo(1);

        String others = "Bearer " + jwt.issueAccessToken(member()).value();
        assertThat(mark(others, script.dialogue(1), "memorized", 404)).as("남의 줄").isEqualTo(mapper.readTree("{\"detail\":\"line_not_found\"}"));
        assertThat(mark(bearer, UUID.randomUUID(), "memorized", 404)).as("없는 줄").isEqualTo(mapper.readTree("{\"detail\":\"line_not_found\"}"));
        assertThat(count("line_memorization")).isEqualTo(1);
        assertThat(list(others, script.id, 404)).isEqualTo(mapper.readTree("{\"detail\":\"script_not_found\"}"));
    }

    @Test
    @DisplayName("reading.memorization: 두 기기에서 같은 줄을 다르게 갱신 — 마지막 요청이 남는다. 오프라인 토글 뒤 연결 — 서버 값이 마지막에 보낸 기기 값과 같다")
    void readingMemorization_theLastRequestWins() throws Exception {
        String phone = "Bearer " + jwt.issueAccessToken(member).value();
        mark(bearer, script.dialogue(1), "memorized", 200);
        clock.advance(Duration.ofSeconds(1));
        mark(phone, script.dialogue(1), "not_yet", 200);
        clock.advance(Duration.ofSeconds(1));
        JsonNode last = mark(bearer, script.dialogue(1), "memorized", 200);

        assertThat(last.path("status").textValue()).isEqualTo("memorized");
        assertThat(Instant.parse(last.path("updated_at").textValue())).isEqualTo(clock.instant());
        assertThat(count("line_memorization")).isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT status FROM line_memorization", String.class)).isEqualTo("memorized");
        JsonNode rows = list(phone, script.id, 200);
        assertThat(rows).hasSize(1);
        assertThat(rows.get(0).path("status").textValue()).as("다른 기기의 조회도 마지막 값").isEqualTo("memorized");
        assertThat(Instant.parse(rows.get(0).path("updated_at").textValue())).isEqualTo(clock.instant());
    }

    @Test
    @DisplayName("reading.memorization: 본문이 비거나 모르는 상태·모르는 키 — 422 배열이고 행이 없다. 동의하지 않은 게스트 — 403 consent_required")
    void readingMemorization_malformedBodiesAndUnconsentedGuests() throws Exception {
        for (String body : List.of("{}", "{\"status\":null}", "{\"status\":\"maybe\"}", "{\"status\":\"MEMORIZED\"}",
                "{\"status\":\"memorized\",\"line_id\":\"" + script.dialogue(1) + "\"}", "[]", "not json")) {
            MockHttpServletResponse response = perform(put("/v2/reading/lines/{id}/memorization", script.dialogue(1))
                    .contentType(MediaType.APPLICATION_JSON).content(body), bearer);
            assertThat(response.getStatus()).as(body + " → " + response.getContentAsString()).isEqualTo(422);
            assertThat(mapper.readTree(response.getContentAsString()).path("detail").isArray()).as(body).isTrue();
        }
        MockHttpServletResponse notUuid = perform(put("/v2/reading/lines/{id}/memorization", "not-a-uuid")
                .contentType(MediaType.APPLICATION_JSON).content("{\"status\":\"memorized\"}"), bearer);
        assertThat(notUuid.getStatus()).isEqualTo(422);
        assertThat(mapper.readTree(notUuid.getContentAsString()).path("detail").isArray()).isTrue();
        assertThat(count("line_memorization")).isZero();

        Guest guest = guest();
        Script guests = saveScript(consentedGuest().bearer());
        MockHttpServletResponse blocked = perform(put("/v2/reading/lines/{id}/memorization", guests.dialogue(1))
                .contentType(MediaType.APPLICATION_JSON).content("{\"status\":\"memorized\"}"), guest.bearer());
        assertThat(blocked.getStatus()).isEqualTo(403);
        assertThat(mapper.readTree(blocked.getContentAsString()).path("detail").textValue()).isEqualTo("consent_required");
        MockHttpServletResponse blockedList = perform(get("/v2/reading/scripts/{id}/memorization", guests.id), guest.bearer());
        assertThat(blockedList.getStatus()).isEqualTo(403);
        assertThat(mapper.readTree(blockedList.getContentAsString()).path("detail").textValue()).isEqualTo("consent_required");
        assertThat(count("line_memorization")).isZero();
    }

    // ---- helpers ----

    private JsonNode mark(String authorization, UUID lineId, String status, int expected) throws Exception {
        MockHttpServletResponse response = perform(put("/v2/reading/lines/{id}/memorization", lineId)
                .contentType(MediaType.APPLICATION_JSON).content("{\"status\":\"" + status + "\"}"), authorization);
        assertThat(response.getStatus()).as(response.getContentAsString()).isEqualTo(expected);
        return mapper.readTree(response.getContentAsString());
    }

    private JsonNode list(String authorization, UUID scriptId, int expected) throws Exception {
        MockHttpServletResponse response = perform(get("/v2/reading/scripts/{id}/memorization", scriptId), authorization);
        assertThat(response.getStatus()).as(response.getContentAsString()).isEqualTo(expected);
        return mapper.readTree(response.getContentAsString());
    }

    private String result(UUID line, String outcome, int misses) {
        return mapper.createObjectNode().put("line_id", line.toString()).put("outcome", outcome).put("misses", misses).toString();
    }

    private record Script(UUID id, UUID nina, UUID treplev, UUID arkadina, UUID scene, UUID direction, List<UUID> dialogues) {
        UUID dialogue(int no) {
            return dialogues.get(no - 1);
        }
    }

    /** 대사 번호와 배역: 1 니나 · 2 트레플레프 · 3 니나 · 4 아르카디나 · 5 아르카디나 · 6 트레플레프 · 7 니나 · 8 니나. */
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

    private UUID startSession(String authorization, Script target, List<UUID> characters, String mode, UUID startLine, UUID endLine)
            throws Exception {
        ObjectNode body = mapper.createObjectNode();
        body.put("request_id", UUID.randomUUID().toString());
        ArrayNode ids = body.putArray("my_character_ids");
        characters.forEach(id -> ids.add(id.toString()));
        body.put("mode", mode);
        body.put("start_line_id", startLine.toString());
        body.put("end_line_id", endLine.toString());
        body.put("advance", "silence");
        body.put("record", false);
        var response = perform(post("/v2/reading/scripts/{id}/sessions", target.id).contentType(MediaType.APPLICATION_JSON)
                .content(body.toString()), authorization);
        assertThat(response.getStatus()).as(response.getContentAsString()).isEqualTo(201);
        return UUID.fromString(mapper.readTree(response.getContentAsString()).path("id").textValue());
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

    /** 아직 아무 문서에도 동의하지 않은 새 게스트. */
    private Guest guest() throws Exception {
        var response = mvc.perform(post("/v2/auth/guest").with(request -> {
            request.setRemoteAddr("10.53." + ADDRESSES.incrementAndGet() + ".1");
            return request;
        })).andReturn().getResponse();
        assertThat(response.getStatus()).isEqualTo(201);
        JsonNode body = mapper.readTree(response.getContentAsString());
        return new Guest(UUID.fromString(body.path("user").path("id").textValue()), "Bearer " + body.path("access_token").textValue());
    }

    /** 리딩의 문서 둘에 동의한 게스트. AI 분석 동의는 없다. */
    private Guest consentedGuest() throws Exception {
        Guest guest = guest();
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
        var response = perform(post("/v2/consents").contentType(MediaType.APPLICATION_JSON).content(mapper.writeValueAsString(body)),
                guest.bearer());
        assertThat(response.getStatus()).as(response.getContentAsString()).isEqualTo(201);
    }

    private void transfer(Guest guest) throws Exception {
        var issued = perform(post("/v2/guest/transfer-code"), guest.bearer());
        assertThat(issued.getStatus()).as(issued.getContentAsString()).isEqualTo(201);
        String code = mapper.readTree(issued.getContentAsString()).path("code").textValue();
        String from = address;
        var response = mvc.perform(post("/v2/guest-transfers")
                        .with(request -> {
                            request.setRemoteAddr(from);
                            return request;
                        })
                        .header("Authorization", bearer)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"code\":\"" + code + "\"}"))
                .andReturn().getResponse();
        assertThat(response.getStatus()).as(response.getContentAsString()).isEqualTo(200);
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
}
