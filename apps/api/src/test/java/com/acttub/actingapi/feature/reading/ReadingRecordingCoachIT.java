package com.acttub.actingapi.feature.reading;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CopyOnWriteArrayList;

import com.acttub.actingapi.feature.auth.app.JwtService;
import com.acttub.actingapi.feature.reading.app.RecordingCoachModel;
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
 * reading.recording-coach(실험, SOMA-791) — 스위치를 켠 배포에서 리딩 회차의 녹음으로 두 차례 대화하는 것을 HTTP 와 실제
 * Postgres 로 본다. 모델은 가짜다(받은 녹음·차례를 적어 두고 정해 둔 답을 낸다).
 */
@SpringBootTest(properties = {
    "JWT_SECRET=test-secret",
    "ACCOUNT_CLEANUP_ENABLED=false",
    "ACCOUNT_HOUSEKEEPING_ENABLED=false",
    "ACTTUB_RECORDING_COACH_ENABLED=true"
})
@AutoConfigureMockMvc
@Import({MutableClock.Fixture.class, ReadingRecordingCoachIT.FakeModel.class})
class ReadingRecordingCoachIT {
    private static final OffsetDateTime PUBLISHED = OffsetDateTime.of(2026, 10, 1, 0, 0, 0, 0, ZoneOffset.UTC);

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        String name = PostgresContainerSupport.createDatabaseName("reading_recording_coach");
        registry.add("spring.datasource.url", () -> PostgresContainerSupport.jdbcUrlFor(name));
        registry.add("spring.datasource.username", PostgresContainerSupport.POSTGRES::getUsername);
        registry.add("spring.datasource.password", PostgresContainerSupport.POSTGRES::getPassword);
    }

    @TestConfiguration(proxyBeanMethods = false)
    static class FakeModel {
        static final List<List<RecordingCoachModel.Turn>> CALLS = new CopyOnWriteArrayList<>();
        static final List<Integer> CLIPS = new CopyOnWriteArrayList<>();

        @Bean
        @Primary
        RecordingCoachModel fakeRecordingCoachModel() {
            return (instruction, script, clips, turns) -> {
                CALLS.add(turns);
                CLIPS.add(clips.size());
                String text = turns.size() == 1
                        ? "<설계>\n들린 것\n고른 녹음: 2\n</설계>\n\"대사 3\"은 끝이 내려가요. 니나는 왜 이 말을 해요?"
                        : "방금 말한 것과 녹음이 맞아요. 소리로는 여기까지예요. 이 한 줄만 영상으로 찍어 볼래요?";
                return new RecordingCoachModel.Reply(text, "fake-model");
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
        clock.set(Instant.parse("2026-10-21T08:00:00Z"));
        FakeModel.CALLS.clear();
        FakeModel.CLIPS.clear();
        member = member();
        bearer = bearer(member);
        session = startSession(bearer);
    }

    @Test
    @DisplayName("reading.recording-coach: 소리가 든 내 대사 녹음 셋으로 첫 차례를 만든다 — 숨은 칸은 응답에 없고 DB 에만 "
            + "남으며, 같은 회차로 다시 부르면 모델을 부르지 않고 200 으로 같은 대화를 준다")
    void start_createsTheFirstTurnOncePerSession() throws Exception {
        recordAll("stt", "대사");

        JsonNode created = json(post("/v2/recording-coaches").content(start(session)), bearer, 201);
        assertThat(created.properties()).extracting(Map.Entry::getKey).containsExactlyInAnyOrder(
                "id", "reading_session_id", "status", "messages", "video_line", "created_at", "updated_at");
        assertThat(created.path("status").textValue()).isEqualTo("asked");
        assertThat(created.path("messages")).hasSize(1);
        assertThat(created.path("messages").get(0).path("role").textValue()).isEqualTo("coach");
        assertThat(created.path("messages").get(0).path("text").textValue())
                .isEqualTo("\"대사 3\"은 끝이 내려가요. 니나는 왜 이 말을 해요?");
        assertThat(created.path("video_line").path("line_id").textValue()).isEqualTo(ninaLines.get(1).toString());
        assertThat(created.path("video_line").path("text").textValue()).isEqualTo("대사 3");
        assertThat(FakeModel.CLIPS).containsExactly(3);

        Map<String, Object> row = jdbc.queryForMap("SELECT * FROM reading_recording_coaches");
        assertThat(row.get("user_id")).isEqualTo(member);
        assertThat(row.get("model")).isEqualTo("fake-model");
        assertThat(row.get("clip_count")).isEqualTo(3);
        assertThat((String) row.get("first_design")).contains("고른 녹음: 2");

        JsonNode again = json(post("/v2/recording-coaches").content(start(session)), bearer, 200);
        assertThat(again.path("id").textValue()).isEqualTo(created.path("id").textValue());
        assertThat(FakeModel.CALLS).hasSize(1);
    }

    @Test
    @DisplayName("reading.recording-coach: 배우 답을 받아 둘째 차례로 영상 권유까지 끝낸다 — 다시 보내도 모델을 다시 "
            + "부르지 않는다")
    void reply_finishesTheConversation() throws Exception {
        recordAll("stt", "대사");
        String id = json(post("/v2/recording-coaches").content(start(session)), bearer, 201).path("id").textValue();

        JsonNode answered = json(post("/v2/recording-coaches/{id}/reply", id).content("{\"text\":\" 화가 나서요 \"}"),
                bearer, 200);
        assertThat(answered.path("status").textValue()).isEqualTo("answered");
        assertThat(answered.path("messages")).hasSize(3);
        assertThat(answered.path("messages").get(1).path("role").textValue()).isEqualTo("actor");
        assertThat(answered.path("messages").get(1).path("text").textValue()).isEqualTo("화가 나서요");
        assertThat(answered.path("messages").get(2).path("text").textValue()).endsWith("찍어 볼래요?");

        json(post("/v2/recording-coaches/{id}/reply", id).content("{\"text\":\"또\"}"), bearer, 200);
        assertThat(FakeModel.CALLS).hasSize(2);
        assertThat(json(get("/v2/recording-coaches/{id}", id), bearer, 200).path("messages")).hasSize(3);
    }

    @Test
    @DisplayName("reading.recording-coach: 소리가 든 녹음이 셋보다 적으면 422 recording_coach_not_enough_audio — 받아쓴 "
            + "글이 빈 녹음은 소리가 없는 것으로 센다")
    void start_needsThreeAudibleLines() throws Exception {
        recordAll("stt", " ");
        MockHttpServletResponse response = perform(post("/v2/recording-coaches").content(start(session)), bearer, 422);
        assertThat(response.getContentAsString()).contains("recording_coach_not_enough_audio");
        assertThat(FakeModel.CALLS).isEmpty();
    }

    @Test
    @DisplayName("reading.recording-coach: 남의 회차는 404 session_not_found, 남의 대화는 404 recording_coach_not_found")
    void othersAreNotFound() throws Exception {
        recordAll("none", null);
        String id = json(post("/v2/recording-coaches").content(start(session)), bearer, 201).path("id").textValue();
        String other = bearer(member());

        assertThat(perform(post("/v2/recording-coaches").content(start(session)), other, 404).getContentAsString())
                .contains("session_not_found");
        assertThat(perform(get("/v2/recording-coaches/{id}", id), other, 404).getContentAsString())
                .contains("recording_coach_not_found");
    }

    @Test
    @DisplayName("reading.recording-coach: 회차가 지워지면 대화도 함께 지워진다(ON DELETE CASCADE)")
    void deletingTheSessionDeletesTheConversation() throws Exception {
        recordAll("stt", "대사");
        json(post("/v2/recording-coaches").content(start(session)), bearer, 201);

        jdbc.update("DELETE FROM reading_recordings WHERE reading_session_id=?", session);
        jdbc.update("DELETE FROM reading_sessions WHERE id=?", session);

        assertThat(jdbc.queryForObject("SELECT count(*) FROM reading_recording_coaches", Integer.class)).isZero();
    }

    private String start(UUID sessionId) {
        return "{\"reading_session_id\":\"" + sessionId + "\"}";
    }

    private void recordAll(String source, String transcript) {
        for (UUID line : ninaLines) {
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
