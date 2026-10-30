package com.acttub.actingapi.feature.reading;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import java.nio.file.Files;
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
import com.acttub.actingapi.feature.reading.app.RetranscribeAudio;
import com.acttub.actingapi.feature.reading.app.RetranscribeRepository;
import com.acttub.actingapi.feature.reading.app.RetranscribeWorker;
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
 * 리딩 녹음 서버 다시 받아쓰기(V79) — 기기 전사가 빈 줄 녹음을 줄 세우고, 일꾼이 소리가 있는 것만 받아써 녹음의 전사·대조를
 * 채우는 것을 실제 Postgres 로 본다. 스토리지·소리 재기·받아쓰기 모델은 가짜다. 예약 일꾼은 테스트가 직접 돌린다.
 */
@SpringBootTest(properties = {
    "JWT_SECRET=test-secret",
    "ACCOUNT_CLEANUP_ENABLED=false",
    "ACCOUNT_HOUSEKEEPING_ENABLED=false",
    "READING_RETRANSCRIBE_ENABLED=true",
    "READING_RETRANSCRIBE_DAILY_LIMIT=3",
    "READING_RETRANSCRIBE_POLL_MS=3600000"
})
@AutoConfigureMockMvc
@Import({MutableClock.Fixture.class, ReadingRetranscribeIT.Fakes.class})
class ReadingRetranscribeIT {
    static final String OWNER = "33333333-3333-4333-8333-333333333333";
    private static final OffsetDateTime PUBLISHED = OffsetDateTime.of(2026, 10, 1, 0, 0, 0, 0, ZoneOffset.UTC);

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        String name = PostgresContainerSupport.createDatabaseName("reading_retranscribe");
        registry.add("spring.datasource.url", () -> PostgresContainerSupport.jdbcUrlFor(name));
        registry.add("spring.datasource.username", PostgresContainerSupport.POSTGRES::getUsername);
        registry.add("spring.datasource.password", PostgresContainerSupport.POSTGRES::getPassword);
    }

    @TestConfiguration(proxyBeanMethods = false)
    static class Fakes {
        static final List<String> DOWNLOADED = new CopyOnWriteArrayList<>();
        static final List<String> TRANSCRIBED = new CopyOnWriteArrayList<>();
        static volatile double peak = -12;
        static volatile String text = "대사 1";

        @Bean
        @Primary
        PronunciationAudio fakeRecordingDownload() {
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
        RetranscribeAudio fakeRetranscribeAudio() {
            return new RetranscribeAudio() {
                @Override
                public double peakDb(java.nio.file.Path audio) {
                    return peak;
                }

                @Override
                public String transcribe(java.nio.file.Path audio) {
                    TRANSCRIBED.add(audio.getFileName().toString());
                    return text;
                }
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
    RetranscribeWorker worker;
    @Autowired
    RetranscribeRepository queue;

    private UUID session;
    private List<UUID> ninaLines;
    private List<UUID> allLines;

    @BeforeEach
    void setUp() throws Exception {
        jdbc.execute("TRUNCATE TABLE users,consent_documents RESTART IDENTITY CASCADE");
        for (String type : List.of("terms", "privacy", "ai_analysis", "retention")) {
            jdbc.update("""
                    INSERT INTO consent_documents(id,type,version,title,body,required,published_at)
                    VALUES (?,?,'v1',?,?,?,?)
                    """, UUID.randomUUID(), type, type + " 제목", type + " 본문", !"retention".equals(type), PUBLISHED);
        }
        clock.set(Instant.parse("2026-10-30T08:00:00Z"));
        Fakes.DOWNLOADED.clear();
        Fakes.TRANSCRIBED.clear();
        Fakes.peak = -12;
        Fakes.text = "대사 1";
        member(UUID.fromString(OWNER));
        session = startSession(bearer(UUID.fromString(OWNER)));
    }

    @Test
    @DisplayName("reading.retranscribe: 소리가 있는 빈 전사 녹음은 받아쓴 글로 전사를 채우고 원문과 대조한다 — 녹음의 전사 출처는 stt 그대로")
    void loudEmptyRecordingIsFilled() {
        UUID recording = recording(ninaLines.get(0), null, "stt");
        queue.enqueue(recording, "rec/" + ninaLines.get(0), clock.instant());

        assertThat(worker.runOnce()).isTrue();
        assertThat(worker.runOnce()).isFalse();

        assertThat(Fakes.DOWNLOADED).containsExactly("rec/" + ninaLines.get(0));
        assertThat(jdbc.queryForMap("SELECT transcript,transcript_source,matched FROM reading_recordings WHERE id=?", recording))
                .containsEntry("transcript", "대사 1").containsEntry("transcript_source", "stt").containsEntry("matched", true);
        Map<String, Object> row = jdbc.queryForMap(
                "SELECT status,transcript,peak_db,transcribed_at,lease_token FROM reading_recording_retranscripts WHERE recording_id=?",
                recording);
        assertThat(row.get("status")).isEqualTo("done");
        assertThat(row.get("transcript")).isEqualTo("대사 1");
        assertThat(row.get("peak_db")).isEqualTo(-12.0);
        assertThat(row.get("transcribed_at")).isNotNull();
        assertThat(row.get("lease_token")).isNull();
    }

    @Test
    @DisplayName("reading.retranscribe: 다르게 받아쓰면 matched false, 소리가 작으면 모델에 보내지 않고 silent")
    void missAndSilent() {
        UUID missed = recording(ninaLines.get(0), null, "stt");
        queue.enqueue(missed, "rec/" + ninaLines.get(0), clock.instant());
        Fakes.text = "전혀 다른 말을 길게 했다";
        assertThat(worker.runOnce()).isTrue();
        assertThat(jdbc.queryForObject("SELECT matched FROM reading_recordings WHERE id=?", Boolean.class, missed)).isFalse();

        UUID quiet = recording(ninaLines.get(1), null, "stt");
        queue.enqueue(quiet, "rec/" + ninaLines.get(1), clock.instant());
        Fakes.peak = -50;
        assertThat(worker.runOnce()).isTrue();
        assertThat(Fakes.TRANSCRIBED).hasSize(1);
        assertThat(jdbc.queryForMap("SELECT transcript,matched FROM reading_recordings WHERE id=?", quiet))
                .containsEntry("transcript", null).containsEntry("matched", null);
        assertThat(jdbc.queryForObject("SELECT status FROM reading_recording_retranscripts WHERE recording_id=?", String.class,
                quiet)).isEqualTo("silent");
    }

    @Test
    @DisplayName("reading.retranscribe: 처리 전에 기기가 같은 줄을 다시 올려 녹음이 바뀌었으면 건드리지 않고 stale")
    void replacedRecordingIsStale() {
        UUID recording = recording(ninaLines.get(0), null, "stt");
        queue.enqueue(recording, "rec/" + ninaLines.get(0), clock.instant());
        jdbc.update("UPDATE reading_recordings SET object_key='rec/new', transcript='대사 1', matched=true WHERE id=?", recording);

        assertThat(worker.runOnce()).isTrue();

        assertThat(Fakes.DOWNLOADED).isEmpty();
        assertThat(jdbc.queryForObject("SELECT status FROM reading_recording_retranscripts WHERE recording_id=?", String.class,
                recording)).isEqualTo("stale");
        assertThat(jdbc.queryForObject("SELECT object_key FROM reading_recordings WHERE id=?", String.class, recording))
                .isEqualTo("rec/new");
    }

    @Test
    @DisplayName("reading.retranscribe: 최근 24시간 모델 호출이 한도에 닿으면 미루고 시도 수를 되돌린다. 다시 줄 세우면 처음부터")
    void dailyLimitDefers() {
        for (int index = 0; index < 3; index++) {
            UUID done = recording(ninaLines.get(index), "대사", "stt");
            jdbc.update("""
                    INSERT INTO reading_recording_retranscripts(recording_id,object_key,status,transcribed_at)
                    VALUES (?,?,'done',?)
                    """, done, "rec/" + ninaLines.get(index), OffsetDateTime.parse("2026-10-30T07:00:00Z"));
        }
        // 트레플레프 줄 — 내 대사가 아니라 대조 원문이 없어 matched 는 NULL 로 남는다.
        UUID line = allLines.get(1);
        UUID waiting = recording(line, null, "stt");
        queue.enqueue(waiting, "rec/" + line, clock.instant());

        assertThat(worker.runOnce()).isFalse();

        assertThat(jdbc.queryForMap("SELECT status,attempt_count FROM reading_recording_retranscripts WHERE recording_id=?",
                waiting)).containsEntry("status", "queued").containsEntry("attempt_count", 0);
        assertThat(Fakes.DOWNLOADED).isEmpty();

        clock.set(Instant.parse("2026-10-31T07:30:00Z"));
        assertThat(worker.runOnce()).isTrue();
        assertThat(jdbc.queryForObject("SELECT status FROM reading_recording_retranscripts WHERE recording_id=?", String.class,
                waiting)).isEqualTo("done");
        assertThat(jdbc.queryForMap("SELECT transcript,matched FROM reading_recordings WHERE id=?", waiting))
                .containsEntry("transcript", "대사 1").containsEntry("matched", null);
    }

    @Test
    @DisplayName("reading.retranscribe: 녹음을 지우면 큐의 행도 지운다")
    void deletingTheRecordingDeletesTheRow() {
        UUID recording = recording(ninaLines.get(0), null, "stt");
        queue.enqueue(recording, "rec/" + ninaLines.get(0), clock.instant());
        jdbc.update("DELETE FROM reading_recordings WHERE id=?", recording);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM reading_recording_retranscripts", Integer.class)).isZero();
        assertThat(worker.runOnce()).isFalse();
    }

    private UUID recording(UUID line, String transcript, String source) {
        UUID id = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO reading_recordings(id,user_id,reading_session_id,line_id,request_id,attempt_no,object_key,
                                               content_type,byte_size,duration_ms,transcript,transcript_source)
                VALUES (?,?,?,?,?,1,?,'audio/mp4',20000,1500,?,?)
                """, id, UUID.fromString(OWNER), session, line, UUID.randomUUID(), "rec/" + line, transcript, source);
        return id;
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
        allLines = all;
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
