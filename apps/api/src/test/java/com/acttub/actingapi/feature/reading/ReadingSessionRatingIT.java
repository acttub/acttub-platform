package com.acttub.actingapi.feature.reading;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
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
import com.acttub.actingapi.feature.profile.app.ProfileService;
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
 * reading.session 의 회차 평가(SOMA-661) — "이번 리딩 어땠나요?" 의 좋았어요·아쉬웠어요와 한 줄을 HTTP 와 실제
 * Postgres 로 본다. 노트 평가(practice.note, {@code NoteRatingIT})와 같은 모양이다.
 *
 * <p>회차 하나에 사람 하나가 한 행이고({@code uq_reading_session_ratings_session_user}) 다시 누르면 덮어쓴다. 요청 id 로
 * 멱등하고, 같은 id 에 다른 본문이면 422 {@code request_fingerprint_mismatch} 다. 게이트·소유권은
 * {@code GET /v2/reading/sessions/{id}} 와 같다 — 없는 것·남의 것은 같은 404 {@code session_not_found} 다. 평가는
 * 회차 행에 매달려 회차 삭제·대본 삭제·탈퇴 때 함께 지워지고, 이관 때 회차를 따라 회원 것이 된다.
 */
@SpringBootTest(properties = {
    "JWT_SECRET=test-secret",
    "ACCOUNT_CLEANUP_ENABLED=false",
    "ACCOUNT_HOUSEKEEPING_ENABLED=false"
})
@AutoConfigureMockMvc
@Import(MutableClock.Fixture.class)
class ReadingSessionRatingIT {
    private static final AtomicInteger ADDRESSES = new AtomicInteger();
    private static final OffsetDateTime PUBLISHED = OffsetDateTime.of(2026, 10, 1, 0, 0, 0, 0, ZoneOffset.UTC);

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        String name = PostgresContainerSupport.createDatabaseName("reading_session_rating");
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
    ProfileService accounts;

    private final Map<String, UUID> documents = new LinkedHashMap<>();
    private UUID member;
    private String bearer;
    private String address;
    private Script script;
    private UUID session;

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
        clock.set(Instant.parse("2026-10-11T00:00:00Z"));
        address = "10.61.0." + ADDRESSES.incrementAndGet();
        member = member();
        bearer = bearer(member);
        script = saveScript(bearer);
        session = startSession(bearer, script);
    }

    @Test
    @DisplayName("reading.session: 누르는 순간 회차 단위로 저장된다 — 한 줄은 앞뒤 공백을 걷어 같은 행에 붙고, 응답은 "
            + "{rating, comment, updated_at} 이다. 진행 중 회차도 받는다")
    void rating_isStoredPerSession() throws Exception {
        UUID requestId = UUID.randomUUID();
        JsonNode saved = json(rate(requestId, "good", "  상대역 속도가 딱 좋았어요  "), 200);

        assertThat(saved.path("rating").textValue()).isEqualTo("good");
        assertThat(saved.path("comment").textValue()).isEqualTo("상대역 속도가 딱 좋았어요");
        assertThat(saved.path("updated_at").textValue()).isEqualTo("2026-10-11T00:00:00.000000Z");
        assertThat(saved.properties()).extracting(Map.Entry::getKey)
                .containsExactlyInAnyOrder("rating", "comment", "updated_at");

        Map<String, Object> row = jdbc.queryForMap("SELECT * FROM reading_session_ratings");
        assertThat(row.get("session_id")).isEqualTo(session);
        assertThat(row.get("user_id")).isEqualTo(member);
        assertThat(row.get("rating")).isEqualTo("good");
        assertThat(row.get("comment")).isEqualTo("상대역 속도가 딱 좋았어요");
        assertThat(row.get("request_id")).isEqualTo(requestId);
        // 평가는 회차 상태를 바꾸지 않는다.
        assertThat(jdbc.queryForObject("SELECT status FROM reading_sessions WHERE id=?", String.class, session))
                .isEqualTo("in_progress");
    }

    @Test
    @DisplayName("reading.session: 같은 회차에 다시 누르면 덮어쓴다 — 행은 하나이고, 한 줄 없이 보내면 한 줄이 비워진다")
    void rating_overwritesTheSameRow() throws Exception {
        perform(rate(UUID.randomUUID(), "good", "좋았어요"), 200);
        clock.advance(Duration.ofMinutes(3));

        JsonNode changed = json(rate(UUID.randomUUID(), "bad", null), 200);

        assertThat(changed.path("rating").textValue()).isEqualTo("bad");
        assertThat(changed.path("comment").isNull()).isTrue();
        assertThat(changed.path("updated_at").textValue()).isEqualTo("2026-10-11T00:03:00.000000Z");
        assertThat(count("reading_session_ratings")).isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT created_at < updated_at FROM reading_session_ratings", Boolean.class))
                .isTrue();

        // 빈 한 줄은 없는 것과 같다. null 을 실어 보내도 같다.
        assertThat(json(rate(UUID.randomUUID(), "good", "   "), 200).path("comment").isNull()).isTrue();
        assertThat(json(put("/v2/reading/sessions/{id}/rating", session).content(
                        "{\"request_id\":\"%s\",\"rating\":\"good\",\"comment\":null}".formatted(UUID.randomUUID())), 200)
                .path("comment").isNull()).isTrue();
        assertThat(jdbc.queryForObject("SELECT comment FROM reading_session_ratings", String.class)).isNull();
    }

    @Test
    @DisplayName("reading.session: 같은 request_id·같은 본문의 재전송은 200 같은 응답이고 행을 바꾸지 않는다. 같은 id 에 "
            + "다른 본문은 422 request_fingerprint_mismatch")
    void rating_isIdempotentPerRequestId() throws Exception {
        UUID requestId = UUID.randomUUID();
        String first = perform(rate(requestId, "good", "좋았어요"), 200).getContentAsString();
        clock.advance(Duration.ofMinutes(5));

        String again = perform(rate(requestId, "good", " 좋았어요 "), 200).getContentAsString();

        assertThat(mapper.readTree(again)).isEqualTo(mapper.readTree(first));
        assertThat(count("reading_session_ratings")).isEqualTo(1);

        for (String[] changed : new String[][] {{"bad", "좋았어요"}, {"good", "다른 말"}, {"good", null}}) {
            assertThat(mapper.readTree(perform(rate(requestId, changed[0], changed[1]), 422).getContentAsString()))
                    .isEqualTo(mapper.readTree("{\"detail\":\"request_fingerprint_mismatch\"}"));
        }
        assertThat(jdbc.queryForMap("SELECT rating,comment FROM reading_session_ratings"))
                .containsEntry("rating", "good")
                .containsEntry("comment", "좋았어요");
    }

    @Test
    @DisplayName("reading.session: 남의 회차·없는 회차는 회차 조회와 같은 404 session_not_found 이고 아무것도 남지 않는다")
    void rating_hidesOthersAndMissingSessions() throws Exception {
        UUID stranger = member();
        String theirBearer = bearer(stranger);
        UUID theirSession = startSession(theirBearer, saveScript(theirBearer));

        for (UUID target : new UUID[] {theirSession, UUID.randomUUID()}) {
            assertThat(mapper.readTree(perform(rate(target, UUID.randomUUID(), "good", null), 404)
                            .getContentAsString()))
                    .isEqualTo(mapper.readTree("{\"detail\":\"session_not_found\"}"));
        }
        assertThat(count("reading_session_ratings")).isZero();
    }

    @Test
    @DisplayName("reading.session: 값 목록 밖의 rating 과 모양이 틀린 본문은 422 배열, 한 줄 101자는 422 comment_too_long "
            + "이다. 길이는 코드 포인트로 세서 이모지 100개는 받는다")
    void rating_validatesTheBody() throws Exception {
        assertThat(json(rate(UUID.randomUUID(), "helpful", null), 422).path("detail").isArray()).isTrue();
        assertThat(json(put("/v2/reading/sessions/{id}/rating", session).content("{\"rating\":\"good\"}"), 422)
                .path("detail").isArray()).isTrue();
        assertThat(json(put("/v2/reading/sessions/{id}/rating", session).content(
                        "{\"request_id\":\"%s\"}".formatted(UUID.randomUUID())), 422)
                .path("detail").isArray()).isTrue();
        assertThat(json(put("/v2/reading/sessions/{id}/rating", session).content(
                        "{\"request_id\":\"%s\",\"rating\":\"good\",\"score\":5}".formatted(UUID.randomUUID())), 422)
                .path("detail").isArray()).isTrue();

        assertThat(mapper.readTree(perform(rate(UUID.randomUUID(), "good", "가".repeat(101)), 422)
                        .getContentAsString()))
                .isEqualTo(mapper.readTree("{\"detail\":\"comment_too_long\"}"));
        assertThat(count("reading_session_ratings")).isZero();
        perform(rate(UUID.randomUUID(), "good", "가".repeat(100)), 200);
        perform(rate(UUID.randomUUID(), "bad", "🎭".repeat(100)), 200);
        assertThat(jdbc.queryForObject("SELECT rating FROM reading_session_ratings", String.class)).isEqualTo("bad");
    }

    @Test
    @DisplayName("reading.session: 회차 조회의 my_rating 은 남긴 평가가 없으면 null 이고, 남기면 그 값이다. 끝난 회차도 받는다")
    void sessionRead_carriesMyRating() throws Exception {
        JsonNode before = json(get("/v2/reading/sessions/{id}", session), 200);
        assertThat(before.has("my_rating")).isTrue();
        assertThat(before.path("my_rating").isNull()).isTrue();

        json(org.springframework.test.web.servlet.request.MockMvcRequestBuilders
                .patch("/v2/reading/sessions/{id}/progress", session)
                .content("{\"progress_seq\":1,\"complete\":true}"), 200);
        perform(rate(UUID.randomUUID(), "bad", "상대역이 너무 빨랐어요"), 200);

        JsonNode after = json(get("/v2/reading/sessions/{id}", session), 200);
        assertThat(after.path("status").textValue()).isEqualTo("completed");
        assertThat(after.path("my_rating").path("rating").textValue()).isEqualTo("bad");
        assertThat(after.path("my_rating").path("comment").textValue()).isEqualTo("상대역이 너무 빨랐어요");
        assertThat(after.path("my_rating").path("updated_at").textValue()).isEqualTo("2026-10-11T00:00:00.000000Z");
    }

    @Test
    @DisplayName("reading.session: 회차를 지우면 그 평가도 지워지고, 대본을 지우면 그 대본 회차들의 평가가 지워진다")
    void deletingTheSessionOrScriptDeletesItsRating() throws Exception {
        perform(rate(UUID.randomUUID(), "good", null), 200);
        UUID other = startSession(bearer, script);
        perform(rate(other, UUID.randomUUID(), "bad", "한 줄"), 200);

        perform(delete("/v2/reading/sessions/{id}", session), 204);
        assertThat(jdbc.queryForList("SELECT session_id FROM reading_session_ratings", UUID.class)).containsExactly(other);

        perform(delete("/v2/reading/scripts/{id}", script.id()), 204);
        assertThat(count("reading_session_ratings")).isZero();
    }

    @Test
    @DisplayName("account.withdraw: 탈퇴하면 리딩 회차와 함께 평가도 행째 지워진다")
    void withdrawal_erasesTheRating() throws Exception {
        perform(rate(UUID.randomUUID(), "good", "연락 주세요 010-0000-0000"), 200);

        accounts.withdraw(member);

        assertThat(count("reading_session_ratings")).isZero();
        assertThat(count("reading_sessions")).isZero();
    }

    @Test
    @DisplayName("account.guest: 웹 게스트가 남긴 평가는 이관 때 회차를 따라 회원 것이 된다 — 회원의 회차 조회에 그대로 보인다")
    void guestTransfer_movesTheRatingWithTheSession() throws Exception {
        Guest guest = consentedGuest();
        UUID guestSession = startSession(guest.bearer(), saveScript(guest.bearer()));
        var rated = mvc.perform(rate(guestSession, UUID.randomUUID(), "good", "게스트 때 남김")
                        .header("Authorization", guest.bearer())
                        .contentType(MediaType.APPLICATION_JSON))
                .andReturn().getResponse();
        assertThat(rated.getStatus()).as(rated.getContentAsString()).isEqualTo(200);

        transfer(guest);

        assertThat(jdbc.queryForObject("SELECT user_id FROM reading_session_ratings WHERE session_id=?", UUID.class,
                guestSession)).isEqualTo(member);
        JsonNode read = json(get("/v2/reading/sessions/{id}", guestSession), 200);
        assertThat(read.path("my_rating").path("rating").textValue()).isEqualTo("good");
        assertThat(read.path("my_rating").path("comment").textValue()).isEqualTo("게스트 때 남김");
    }

    // --- 도우미 -------------------------------------------------------------

    private record Script(UUID id, UUID nina, UUID first, UUID last) {
    }

    private MockHttpServletRequestBuilder rate(UUID requestId, String rating, String comment) {
        return rate(session, requestId, rating, comment);
    }

    private MockHttpServletRequestBuilder rate(UUID sessionId, UUID requestId, String rating, String comment) {
        StringBuilder payload = new StringBuilder("{\"request_id\":\"%s\",\"rating\":\"%s\"".formatted(requestId, rating));
        if (comment != null) {
            payload.append(",\"comment\":\"%s\"".formatted(comment));
        }
        return put("/v2/reading/sessions/{id}/rating", sessionId).content(payload.append("}").toString());
    }

    /** 배역 둘, 대사 넷(니나·트레플레프 번갈아). */
    private Script saveScript(String authorization) throws Exception {
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
        for (int index = 0; index < 4; index++) {
            lines.addObject().put("ordinal", index + 1).put("kind", "dialogue").put("character_index", index % 2)
                    .put("text", "대사 " + (index + 1));
        }
        var response = mvc.perform(post("/v2/reading/scripts")
                        .header("Authorization", authorization)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body.toString()))
                .andReturn().getResponse();
        assertThat(response.getStatus()).as(response.getContentAsString()).isEqualTo(201);
        JsonNode saved = mapper.readTree(response.getContentAsString());
        List<UUID> dialogues = new ArrayList<>();
        for (JsonNode line : saved.path("lines")) {
            dialogues.add(UUID.fromString(line.path("id").textValue()));
        }
        return new Script(
                UUID.fromString(saved.path("id").textValue()),
                UUID.fromString(saved.path("characters").get(0).path("id").textValue()),
                dialogues.getFirst(),
                dialogues.getLast());
    }

    private UUID startSession(String authorization, Script target) throws Exception {
        ObjectNode body = mapper.createObjectNode();
        body.put("request_id", UUID.randomUUID().toString());
        body.putArray("my_character_ids").add(target.nina().toString());
        body.put("mode", "read");
        body.put("start_line_id", target.first().toString());
        body.put("end_line_id", target.last().toString());
        body.put("advance", "silence");
        body.put("record", true);
        var response = mvc.perform(post("/v2/reading/scripts/{id}/sessions", target.id())
                        .header("Authorization", authorization)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body.toString()))
                .andReturn().getResponse();
        assertThat(response.getStatus()).as(response.getContentAsString()).isEqualTo(201);
        return UUID.fromString(mapper.readTree(response.getContentAsString()).path("id").textValue());
    }

    private String bearer(UUID userId) {
        return "Bearer " + jwt.issueAccessToken(userId).value();
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
            request.setRemoteAddr("10.62." + ADDRESSES.incrementAndGet() + ".1");
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
        var response = mvc.perform(post("/v2/consents")
                        .header("Authorization", guest.bearer())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(mapper.writeValueAsString(body)))
                .andReturn().getResponse();
        assertThat(response.getStatus()).as(response.getContentAsString()).isEqualTo(201);
    }

    private void transfer(Guest guest) throws Exception {
        var issued = mvc.perform(post("/v2/guest/transfer-code").header("Authorization", guest.bearer()))
                .andReturn().getResponse();
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

    private int count(String table) {
        return jdbc.queryForObject("SELECT count(*) FROM " + table, Integer.class);
    }

    private JsonNode json(MockHttpServletRequestBuilder request, int status) throws Exception {
        String body = perform(request, status).getContentAsString();
        return body.isEmpty() ? mapper.nullNode() : mapper.readTree(body);
    }

    private MockHttpServletResponse perform(MockHttpServletRequestBuilder request, int status) throws Exception {
        MockHttpServletResponse response = mvc.perform(request
                        .header("Authorization", bearer)
                        .contentType(MediaType.APPLICATION_JSON))
                .andReturn()
                .getResponse();
        assertThat(response.getStatus()).as(response.getContentAsString()).isEqualTo(status);
        return response;
    }
}
