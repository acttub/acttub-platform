package com.acttub.actingapi.feature.reading;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
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
import com.acttub.actingapi.feature.coach.app.CoachReadingAudio;

/**
 * reading.voice-coaching(SOMA-791) — 스위치를 켠 배포에서 리딩 회차의 녹음으로 코칭 회차를 시작하는 것을 HTTP 와 실제 Postgres 로 본다.
 * 리딩 완료 화면 카드 확인, 코칭 시작(무료·목적 reading·리딩 회차 하나에 하나), 코치가 읽는 재료 글.
 */
@SpringBootTest(properties = {
    "JWT_SECRET=test-secret",
    "ACCOUNT_CLEANUP_ENABLED=false",
    "ACCOUNT_HOUSEKEEPING_ENABLED=false",
    "ACTTUB_READING_VOICE_COACHING_ENABLED=true"
})
@AutoConfigureMockMvc
@Import(MutableClock.Fixture.class)
class ReadingVoiceCoachingIT {
    private static final OffsetDateTime PUBLISHED = OffsetDateTime.of(2026, 10, 1, 0, 0, 0, 0, ZoneOffset.UTC);

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        String name = PostgresContainerSupport.createDatabaseName("reading_voice_coaching");
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
    CoachReadingAudio readingAudio;

    private UUID member;
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
        clock.set(Instant.parse("2026-10-27T08:00:00Z"));
        member = member();
        bearer = bearer(member);
        session = startSession(bearer);
    }

    @Test
    @DisplayName("reading.voice-coaching: 카드는 소리 든 내 대사 녹음이 3줄 이상일 때만 열린다 — 2줄·빈 녹음이면 닫히고, 남의 회차는 404")
    void card_opensOnlyWithThreeAudibleLines() throws Exception {
        record(3, "stt", "  ");
        JsonNode silent = json(get("/v2/reading/sessions/{id}/voice-coaching", session), bearer, 200);
        assertThat(silent.path("available").booleanValue()).isFalse();
        assertThat(silent.path("practice_id").isNull()).isTrue();

        jdbc.update("DELETE FROM reading_recordings");
        record(2, "stt", "대사");
        assertThat(json(get("/v2/reading/sessions/{id}/voice-coaching", session), bearer, 200).path("available").booleanValue())
                .isFalse();
        JsonNode refused = json(post("/v2/practices").content(start(session)), bearer, 422);
        assertThat(refused).isEqualTo(mapper.readTree("{\"detail\":\"reading_voice_not_enough_audio\"}"));

        jdbc.update("DELETE FROM reading_recordings");
        record(3, "stt", "대사");
        assertThat(json(get("/v2/reading/sessions/{id}/voice-coaching", session), bearer, 200).path("available").booleanValue())
                .isTrue();

        String stranger = bearer(member());
        assertThat(json(get("/v2/reading/sessions/{id}/voice-coaching", session), stranger, 404))
                .isEqualTo(mapper.readTree("{\"detail\":\"session_not_found\"}"));
        assertThat(json(post("/v2/practices").content(start(session)), stranger, 404))
                .isEqualTo(mapper.readTree("{\"detail\":\"session_not_found\"}"));
    }

    @Test
    @DisplayName("reading.voice-coaching: 시작하면 영상 없이 목적 reading 으로 바로 대화 회차가 생기고, 같은 리딩 회차로 다시 누르면 같은 회차다")
    void start_createsOneConversingPracticePerReadingSession() throws Exception {
        record(3, "stt", "대사");

        JsonNode created = json(post("/v2/practices").content(start(session)), bearer, 201);
        assertThat(created.path("video_id").isNull()).isTrue();
        assertThat(created.path("session_purpose").textValue()).isEqualTo("reading");
        assertThat(created.path("stage").textValue()).isEqualTo("conversing");
        UUID practice = UUID.fromString(created.path("id").textValue());
        assertThat(jdbc.queryForObject("SELECT reading_session_id FROM practices WHERE id=?", UUID.class, practice))
                .isEqualTo(session);
        assertThat(jdbc.queryForObject("SELECT experience_version FROM practices WHERE id=?", String.class, practice))
                .isEqualTo("three_layers_v1");

        JsonNode again = json(post("/v2/practices").content(start(session)), bearer, 201);
        assertThat(again.path("id").textValue()).isEqualTo(practice.toString());
        assertThat(jdbc.queryForObject("SELECT count(*) FROM practices", Integer.class)).isEqualTo(1);
        assertThat(json(get("/v2/reading/sessions/{id}/voice-coaching", session), bearer, 200).path("practice_id").textValue())
                .isEqualTo(practice.toString());

        CoachReadingAudio.Prepared material = readingAudio.prepare(member, practice, false);
        assertThat(material.audio()).isNull();
        assertThat(material.mimeType()).isEqualTo("audio/wav");
        assertThat(material.material()).startsWith("[리딩 녹음]\n[대본]\n1. 니나(내 대사, 녹음 1): 대사 1\n2. 트레플레프(상대 대사): 대사 2\n")
                .contains("- 녹음 3: ", "\"대사 5\"", "[서버가 잰 소리]");
        assertThat(readingAudio.prepare(bearerless(), practice, false)).as("남의 회차는 재료가 없다").isNull();
    }

    @Test
    @DisplayName("reading.voice-coaching: 요청은 리딩 회차만 싣는다 — 영상이나 목적을 같이 보내면 422 배열이고 아무것도 남지 않는다")
    void start_rejectsAVideoOrPurposeAlongside() throws Exception {
        record(3, "stt", "대사");
        ObjectNode body = (ObjectNode) mapper.readTree(start(session));
        body.put("session_purpose", "character");
        perform(post("/v2/practices").content(body.toString()), bearer, 422);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM practices", Integer.class)).isZero();
    }

    private UUID bearerless() {
        return UUID.randomUUID();
    }

    private String start(UUID sessionId) {
        UUID requestId = UUID.randomUUID();
        return "{\"request_id\":\"" + requestId + "\",\"reading_session_id\":\"" + sessionId + "\"}";
    }

    private void record(int count, String source, String transcript) {
        for (UUID line : ninaLines.subList(0, count)) {
            jdbc.update("""
                    INSERT INTO reading_recordings(id,user_id,reading_session_id,line_id,request_id,attempt_no,object_key,
                                                   content_type,byte_size,duration_ms,transcript,transcript_source)
                    VALUES (?,?,?,?,?,1,?,'audio/mp4',20000,1500,?,?)
                    """, UUID.randomUUID(), member, session, line, UUID.randomUUID(), "rec/" + line, transcript, source);
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

    private UUID member() {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO users(id,status) VALUES (?,'active')", id);
        jdbc.update("INSERT INTO user_identities(id,user_id,provider,provider_uid) VALUES (?,?,'google',?)",
                UUID.randomUUID(), id, "g-" + id);
        AccountFixtures.passGate(jdbc, id);
        return id;
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
