package com.acttub.actingapi.feature.reading;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
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
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.IntSupplier;

import com.acttub.actingapi.feature.auth.app.JwtService;
import com.acttub.actingapi.feature.profile.app.AccountCleanup;
import com.acttub.actingapi.integration.media.AudioTranscoder;
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
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.test.web.servlet.request.MockMultipartHttpServletRequestBuilder;

/**
 * reading.recording 의 "검증 방법" 가운데 서버가 맡는 항목을 HTTP 와 실제 Postgres 로 본다. 오브젝트 스토리지는 메모리의
 * 가짜이고 ffmpeg 는 명령을 흉내 내는 실행기다(진짜 변환은 {@code AudioTranscoderTest}). 컨테이너의 multipart 파싱은
 * {@code ReadingRecordingUploadServerIT} 가 실제 서버로 본다.
 *
 * <p>여기서 보지 못하는 것: 마이크·일시정지·상대역 재생 중의 녹음 여부(기기), 재생 URL 의 실제 만료(저장소), 보관 동의자
 * 탈퇴·3년 파기·객체 삭제 7일 연속 실패 알림(RA5).
 */
@SpringBootTest(properties = {
    "JWT_SECRET=test-secret",
    "ACCOUNT_CLEANUP_ENABLED=false",
    "ACCOUNT_HOUSEKEEPING_ENABLED=false",
    "spring.datasource.hikari.maximum-pool-size=12"
})
@AutoConfigureMockMvc
@Import({MutableClock.Fixture.class, ReadingRecordingIT.Fixture.class})
class ReadingRecordingIT {
    private static final AtomicInteger ADDRESSES = new AtomicInteger();
    private static final long TRANSFER_GATE = 546_004L;
    private static final OffsetDateTime PUBLISHED = OffsetDateTime.of(2026, 10, 1, 0, 0, 0, 0, ZoneOffset.UTC);
    private static final byte[] M4A = "m4a-bytes".getBytes(StandardCharsets.UTF_8);
    private static String database;

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        String name = PostgresContainerSupport.createDatabaseName("reading_recording");
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

    @Autowired
    FakeFfmpeg ffmpeg;

    @Autowired
    AccountCleanup cleanup;

    private final Map<String, UUID> documents = new LinkedHashMap<>();
    private UUID member;
    private String bearer;
    private String address;
    private Script script;
    /** 니나를 내 배역으로 전체 구간·녹음 켬으로 시작한 회차. */
    private UUID session;

    @BeforeEach
    void setUp() throws Exception {
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
        storage.failing.clear();
        ffmpeg.failing.set(false);
        clock.set(Instant.now().truncatedTo(java.time.temporal.ChronoUnit.SECONDS));
        address = "10.50.0." + ADDRESSES.incrementAndGet();
        member = member();
        bearer = "Bearer " + jwt.issueAccessToken(member).value();
        script = saveScript(bearer);
        session = startSession(bearer, script, List.of(script.nina), script.dialogue(1), script.dialogue(8));
    }

    @Test
    @DisplayName("reading.recording: 내 대사 둘을 말함 — reading_recordings 2행, 각 행의 line_id 가 그 줄이고 user_id 가 나이며 객체가 있다. 상대역 줄 — 422 invalid_line 이고 행이 없다. 회차 카드·대본 카드의 수가 맞다")
    void readingRecording_myLinesAreStoredOnePerLine() throws Exception {
        UUID first = UUID.randomUUID();
        JsonNode one = upload(bearer, session, first, script.dialogue(1), 1, "audio/mp4", M4A, 1500, "none", null, null, 201);
        JsonNode three = upload(bearer, session, UUID.randomUUID(), script.dialogue(3), 1, "audio/mp4", M4A, 2500, "none", null, null, 201);

        assertThat(one.fieldNames()).toIterable().containsExactlyInAnyOrder(
                "id", "line_id", "attempt_no", "duration_ms", "content_type", "byte_size", "transcript", "transcript_source",
                "matched", "playback_url", "playback_expires_at");
        assertThat(one.path("line_id").textValue()).isEqualTo(script.dialogue(1).toString());
        assertThat(one.path("attempt_no").intValue()).isEqualTo(1);
        assertThat(one.path("duration_ms").intValue()).isEqualTo(1500);
        assertThat(one.path("content_type").textValue()).isEqualTo("audio/mp4");
        assertThat(one.path("byte_size").longValue()).isEqualTo(M4A.length);
        String key = "reading/" + member + "/" + session + "/" + script.dialogue(1) + "/" + first + ".m4a";
        assertThat(one.path("playback_url").textValue()).isEqualTo("https://storage.test/get/" + key);
        assertThat(storage.objects).containsKeys(key).hasSize(2);
        assertThat(jdbc.queryForList("SELECT line_id FROM reading_recordings ORDER BY created_at", UUID.class))
                .containsExactly(script.dialogue(1), script.dialogue(3));
        assertThat(jdbc.queryForObject("SELECT count(*) FROM reading_recordings WHERE user_id=?", Integer.class, member)).isEqualTo(2);
        assertThat(jdbc.queryForObject("SELECT object_key FROM reading_recordings WHERE id=?", String.class,
                UUID.fromString(one.path("id").textValue()))).isEqualTo(key);
        assertThat(three.path("line_id").textValue()).isEqualTo(script.dialogue(3).toString());

        // 상대역(트레플레프)의 줄에는 행이 생기지 않는다.
        assertThat(upload(bearer, session, UUID.randomUUID(), script.dialogue(2), 1, "audio/mp4", M4A, 900, "none", null, null, 422))
                .isEqualTo(mapper.readTree("{\"detail\":\"invalid_line\"}"));
        assertThat(count("reading_recordings")).isEqualTo(2);
        assertThat(storage.objects).hasSize(2);

        JsonNode card = json(get("/v2/reading/scripts/{id}/sessions", script.id), 200).path("sessions").get(0);
        assertThat(card.path("recorded_line_count").intValue()).as("내 대사 4개 중 2개 녹음").isEqualTo(2);
        assertThat(card.path("my_dialogue_count").intValue()).isEqualTo(4);
        assertThat(json(get("/v2/reading/scripts"), 200).path("scripts").get(0).path("recording_count").intValue()).isEqualTo(2);
        assertThat(json(get("/v2/reading/scripts/{id}", script.id), 200).path("recording_count").intValue()).isEqualTo(2);
    }

    @Test
    @DisplayName("reading.recording: 같은 줄을 \"다시\"로 다시 말함(attempt_no 2) — 행은 하나, 객체 키가 바뀌고 이전 키가 삭제 장부에 있다")
    void readingRecording_aRetakeReplacesTheEarlierObject() throws Exception {
        UUID first = UUID.randomUUID();
        JsonNode take1 = upload(bearer, session, first, script.dialogue(1), 1, "audio/mp4", M4A, 1000, "none", null, null, 201);
        String firstKey = "reading/" + member + "/" + session + "/" + script.dialogue(1) + "/" + first + ".m4a";
        storage.failing.add(firstKey);

        UUID second = UUID.randomUUID();
        JsonNode take2 = upload(bearer, session, second, script.dialogue(1), 2, "audio/mp4", "retake".getBytes(StandardCharsets.UTF_8), 1200,
                "none", null, null, 201);

        String secondKey = "reading/" + member + "/" + session + "/" + script.dialogue(1) + "/" + second + ".m4a";
        assertThat(take2.path("id").textValue()).as("행은 하나다").isEqualTo(take1.path("id").textValue());
        assertThat(take2.path("attempt_no").intValue()).isEqualTo(2);
        assertThat(take2.path("byte_size").longValue()).isEqualTo(6);
        assertThat(take2.path("playback_url").textValue()).endsWith(secondKey);
        assertThat(count("reading_recordings")).isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT object_key FROM reading_recordings", String.class)).isEqualTo(secondKey);
        assertThat(storage.objects).as("저장소가 거절해 앞 객체는 아직 있다").containsKeys(firstKey, secondKey);
        assertThat(jdbc.queryForObject("SELECT kind FROM account_cleanup_operations", String.class))
                .as("이전 키가 삭제 장부에 있다").isEqualTo("reading_recording_delete");

        storage.failing.clear();
        clock.advance(Duration.ofMinutes(6));
        cleanup.runDue();

        assertThat(storage.objects).containsOnlyKeys(secondKey);
        assertThat(count("account_cleanup_operations")).isZero();
    }

    @Test
    @DisplayName("reading.recording: 같은 요청 id 재전송 — 행 하나, 객체 하나. attempt_no 1 이 attempt_no 2 뒤에 늦게 도착 — 200 이고 행은 2번 그대로다")
    void readingRecording_sameRequestIsIdempotentAndOlderAttemptsAreIgnored() throws Exception {
        UUID requestId = UUID.randomUUID();
        JsonNode created = upload(bearer, session, requestId, script.dialogue(1), 1, "audio/mp4", M4A, 1000, "none", null, null, 201);

        JsonNode replayed = upload(bearer, session, requestId, script.dialogue(1), 1, "audio/mp4", M4A, 1000, "none", null, null, 200);

        assertThat(replayed.path("id").textValue()).isEqualTo(created.path("id").textValue());
        assertThat(count("reading_recordings")).isEqualTo(1);
        assertThat(storage.objects).as("응답만 유실된 올리기를 재시도해도 객체는 하나다").hasSize(1);

        JsonNode take2 = upload(bearer, session, UUID.randomUUID(), script.dialogue(1), 2, "audio/mp4", M4A, 1100, "none", null, null, 201);
        JsonNode late = upload(bearer, session, UUID.randomUUID(), script.dialogue(1), 1, "audio/mp4", M4A, 900, "none", null, null, 200);

        assertThat(late.path("attempt_no").intValue()).as("더 작은 시도 번호는 무시하고 현재 값").isEqualTo(2);
        assertThat(late.path("duration_ms").intValue()).isEqualTo(1100);
        assertThat(late.path("id").textValue()).isEqualTo(take2.path("id").textValue());
        assertThat(count("reading_recordings")).isEqualTo(1);
        assertThat(storage.objects).as("늦은 객체는 남지 않는다").hasSize(1);
        assertThat(count("account_cleanup_operations")).isZero();
        assertThat(upload(bearer, session, UUID.randomUUID(), script.dialogue(1), 2, "audio/mp4", M4A, 900, "none", null, null, 200)
                .path("attempt_no").intValue()).as("같은 번호도 무시한다").isEqualTo(2);
    }

    @Test
    @DisplayName("reading.recording: 웹 게스트가 webm/opus 로 둘을 올리고 앱으로 옮김 — 저장된 객체는 m4a 이고 content_type 이 audio/mp4 다. 회원의 회차 상세에 녹음 둘이 보이고 재생 주소가 있으며 user_id 가 회원이다")
    void readingRecording_webmIsTranscodedAndMovesWithTheGuest() throws Exception {
        Guest guest = consentedGuest();
        Script guests = saveScript(guest.bearer());
        UUID guestSession = startSession(guest.bearer(), guests, List.of(guests.nina), guests.dialogue(1), guests.dialogue(8));
        byte[] webm = "webm-opus-bytes".getBytes(StandardCharsets.UTF_8);

        JsonNode first = upload(guest.bearer(), guestSession, UUID.randomUUID(), guests.dialogue(1), 1, "audio/webm;codecs=opus", webm,
                1500, "stt", "안녕하세요", "true", 201);
        upload(guest.bearer(), guestSession, UUID.randomUUID(), guests.dialogue(3), 1, "audio/webm", webm, 1700, "none", null, null, 201);

        assertThat(first.path("content_type").textValue()).isEqualTo("audio/mp4");
        assertThat(first.path("byte_size").longValue()).as("변환 뒤 크기").isEqualTo(FakeFfmpeg.OUTPUT.length);
        assertThat(ffmpeg.commands).hasSize(2);
        assertThat(ffmpeg.commands.getFirst()).contains("-c:a", "aac").last().asString().endsWith(".m4a");
        assertThat(jdbc.queryForList("SELECT object_key FROM reading_recordings", String.class)).allSatisfy(key -> {
            assertThat(key).startsWith("reading/" + guest.id() + "/" + guestSession + "/").endsWith(".m4a");
            assertThat(storage.objects).containsKey(key);
            assertThat(storage.contentTypes).containsEntry(key, "audio/mp4");
        });

        transfer(guest);

        JsonNode detail = json(get("/v2/reading/sessions/{id}", guestSession), 200);
        assertThat(detail.path("recordings")).hasSize(2);
        assertThat(detail.path("recordings")).extracting(row -> row.path("line_id").textValue())
                .containsExactly(guests.dialogue(1).toString(), guests.dialogue(3).toString());
        assertThat(detail.path("recordings").get(0).path("playback_url").textValue()).startsWith("https://storage.test/get/reading/");
        assertThat(detail.path("recordings").get(0).path("transcript").textValue()).isEqualTo("안녕하세요");
        assertThat(detail.path("recording_count").isMissingNode()).isTrue();
        assertThat(jdbc.queryForList("SELECT user_id FROM reading_recordings", UUID.class)).containsOnly(member);
        assertThat(json(get("/v2/reading/scripts/{id}", guests.id), 200).path("recording_count").intValue()).isEqualTo(2);
    }

    @Test
    @DisplayName("reading.recording: 변환을 실패시킴 — 503 audio_conversion_failed, 행·객체 없음. 같은 요청 id 로 다시 — 저장된다")
    void readingRecording_conversionFailureLeavesNothingAndTheRetrySucceeds() throws Exception {
        ffmpeg.failing.set(true);
        UUID requestId = UUID.randomUUID();

        JsonNode failed = upload(bearer, session, requestId, script.dialogue(1), 1, "audio/webm", "webm".getBytes(StandardCharsets.UTF_8),
                1000, "none", null, null, 503);

        assertThat(failed).isEqualTo(mapper.readTree("{\"detail\":\"audio_conversion_failed\"}"));
        assertThat(count("reading_recordings")).isZero();
        assertThat(storage.objects).isEmpty();
        assertThat(count("account_cleanup_operations")).isZero();

        ffmpeg.failing.set(false);
        JsonNode retried = upload(bearer, session, requestId, script.dialogue(1), 1, "audio/webm", "webm".getBytes(StandardCharsets.UTF_8),
                1000, "none", null, null, 201);
        assertThat(retried.path("line_id").textValue()).isEqualTo(script.dialogue(1).toString());
        assertThat(count("reading_recordings")).isEqualTo(1);
        assertThat(storage.objects).hasSize(1);
    }

    @Test
    @DisplayName("reading.recording: 10,000,001바이트 — 422 recording_too_long, 행 없음. 181초 — 422 recording_too_long. 정확히 10,000,000바이트·180초 — 저장된다")
    void readingRecording_sizeAndDurationLimits() throws Exception {
        assertThat(upload(bearer, session, UUID.randomUUID(), script.dialogue(1), 1, "audio/mp4", new byte[10_000_001], 1000, "none",
                null, null, 422)).isEqualTo(mapper.readTree("{\"detail\":\"recording_too_long\"}"));
        assertThat(upload(bearer, session, UUID.randomUUID(), script.dialogue(1), 1, "audio/mp4", M4A, 180_001, "none", null, null, 422))
                .isEqualTo(mapper.readTree("{\"detail\":\"recording_too_long\"}"));
        assertThat(count("reading_recordings")).isZero();
        assertThat(storage.objects).isEmpty();

        JsonNode limit = upload(bearer, session, UUID.randomUUID(), script.dialogue(1), 1, "audio/mp4", new byte[10_000_000], 180_000, "none",
                null, null, 201);
        assertThat(limit.path("byte_size").longValue()).isEqualTo(10_000_000L);
        assertThat(limit.path("duration_ms").intValue()).isEqualTo(180_000);
    }

    @Test
    @DisplayName("reading.recording: 총량 1,000,000,000바이트를 넘긴 회원의 새 녹음 — 422 recording_quota, 기존 행 그대로. 게스트 100,000,000바이트 초과도 같다. 이관으로 총량을 넘긴 회원 — 기존은 모두 보이고 새 저장만 422")
    void readingRecording_quotaKeepsTheExistingRowsAndRejectsOnlyNewOnes() throws Exception {
        seedRecording(member, session, script.dialogue(3), 999_999_995L);

        JsonNode rejected = upload(bearer, session, UUID.randomUUID(), script.dialogue(1), 1, "audio/mp4", M4A, 1000, "none", null, null, 422);

        assertThat(rejected).isEqualTo(mapper.readTree("{\"detail\":\"recording_quota\"}"));
        assertThat(count("reading_recordings")).isEqualTo(1);
        assertThat(storage.objects).as("올렸던 객체는 장부가 지운다").hasSize(1);
        assertThat(count("account_cleanup_operations")).isZero();
        // 대체는 앞 녹음의 바이트를 빼고 센다 — 같은 줄의 다시 말하기는 된다.
        assertThat(upload(bearer, session, UUID.randomUUID(), script.dialogue(3), 2, "audio/mp4", M4A, 1000, "none", null, null, 201)
                .path("byte_size").longValue()).isEqualTo(M4A.length);

        Guest guest = consentedGuest();
        Script guests = saveScript(guest.bearer());
        UUID guestSession = startSession(guest.bearer(), guests, List.of(guests.nina), guests.dialogue(1), guests.dialogue(8));
        seedRecording(guest.id(), guestSession, guests.dialogue(3), 99_999_995L);
        assertThat(upload(guest.bearer(), guestSession, UUID.randomUUID(), guests.dialogue(1), 1, "audio/mp4", M4A, 1000, "none", null, null, 422))
                .isEqualTo(mapper.readTree("{\"detail\":\"recording_quota\"}"));

        // 회원 9억 + 게스트 1억 → 이관 뒤 회원 10억을 넘는다.
        jdbc.update("UPDATE reading_recordings SET byte_size=900_000_000 WHERE user_id=?", member);
        jdbc.update("UPDATE reading_recordings SET byte_size=100_000_000 WHERE user_id=?", guest.id());
        transfer(guest);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM reading_recordings WHERE user_id=?", Integer.class, member))
                .as("이관으로 넘어도 보존한다").isEqualTo(2);
        assertThat(json(get("/v2/reading/sessions/{id}", guestSession), 200).path("recordings")).hasSize(1);
        assertThat(upload(bearer, session, UUID.randomUUID(), script.dialogue(1), 1, "audio/mp4", M4A, 1000, "none", null, null, 422))
                .isEqualTo(mapper.readTree("{\"detail\":\"recording_quota\"}"));
    }

    @Test
    @DisplayName("reading.recording: 구간 밖 줄 id 또는 상대역 줄 id — 422 invalid_line. completed 회차에 검사를 통과한 올리기 — 201. 지워진 회차 — 404")
    void readingRecording_lineChecksAndClosedOrDeletedSessions() throws Exception {
        UUID partial = startSession(bearer, script, List.of(script.nina), script.dialogue(3), script.dialogue(7));
        for (UUID line : List.of(script.dialogue(1), script.dialogue(8), script.dialogue(4), script.scene, UUID.randomUUID())) {
            assertThat(upload(bearer, partial, UUID.randomUUID(), line, 1, "audio/mp4", M4A, 1000, "none", null, null, 422))
                    .as(line.toString()).isEqualTo(mapper.readTree("{\"detail\":\"invalid_line\"}"));
        }
        assertThat(count("reading_recordings")).isZero();
        assertThat(storage.objects).isEmpty();

        json(patch("/v2/reading/sessions/{id}/progress", partial).content("{\"progress_seq\":1,\"elapsed_seconds\":30,\"complete\":true}"), 200);
        assertThat(upload(bearer, partial, UUID.randomUUID(), script.dialogue(3), 1, "audio/mp4", M4A, 1000, "none", null, null, 201)
                .path("line_id").textValue()).as("올리기는 회차의 진행 상태와 분리된다").isEqualTo(script.dialogue(3).toString());
        assertThat(json(patch("/v2/reading/sessions/{id}/progress", partial).content("{\"progress_seq\":2,\"elapsed_seconds\":31}"), 409))
                .isEqualTo(mapper.readTree("{\"detail\":\"session_closed\"}"));

        assertThat(perform(delete("/v2/reading/sessions/{id}", partial), bearer).getStatus()).isEqualTo(204);
        assertThat(storage.objects).as("회차 삭제로 객체가 없다").isEmpty();
        assertThat(upload(bearer, partial, UUID.randomUUID(), script.dialogue(3), 2, "audio/mp4", M4A, 1000, "none", null, null, 404))
                .isEqualTo(mapper.readTree("{\"detail\":\"session_not_found\"}"));
        assertThat(count("reading_recordings")).as("녹음이 되살아나지 않는다").isZero();
        assertThat(storage.objects).isEmpty();
        assertThat(upload("Bearer " + jwt.issueAccessToken(member()).value(), session, UUID.randomUUID(), script.dialogue(1), 1, "audio/mp4",
                M4A, 1000, "none", null, null, 404)).as("남의 회차").isEqualTo(mapper.readTree("{\"detail\":\"session_not_found\"}"));
    }

    @Test
    @DisplayName("reading.recording: STT 없이 올리기 — transcript_source none, transcript·matched NULL, 201. STT 인식 불가 — matched NULL. 정상 인식 뒤 미달 — false. 통과 — true. none 인데 전사가 실리면 422 배열")
    void readingRecording_transcriptAndMatchFollowTheDevice() throws Exception {
        JsonNode none = upload(bearer, session, UUID.randomUUID(), script.dialogue(1), 1, "audio/mp4", M4A, 1000, "none", null, null, 201);
        assertThat(none.path("transcript_source").textValue()).isEqualTo("none");
        assertThat(none.path("transcript").isNull()).isTrue();
        assertThat(none.path("matched").isNull()).isTrue();

        JsonNode unrecognized = upload(bearer, session, UUID.randomUUID(), script.dialogue(3), 1, "audio/mp4", M4A, 1000, "stt", null, null, 201);
        assertThat(unrecognized.path("transcript_source").textValue()).isEqualTo("stt");
        assertThat(unrecognized.path("matched").isNull()).as("인식 불가·무발화").isTrue();

        JsonNode missed = upload(bearer, session, UUID.randomUUID(), script.dialogue(7), 1, "audio/mp4", M4A, 1000, "stt", "안녕하세유", "false", 201);
        assertThat(missed.path("transcript").textValue()).isEqualTo("안녕하세유");
        assertThat(missed.path("matched").booleanValue()).isFalse();

        JsonNode passed = upload(bearer, session, UUID.randomUUID(), script.dialogue(8), 1, "audio/mp4", M4A, 1000, "stt", "안녕하세요", "true", 201);
        assertThat(passed.path("matched").booleanValue()).isTrue();
        assertThat(jdbc.queryForMap("SELECT transcript,transcript_source,matched FROM reading_recordings WHERE id=?",
                UUID.fromString(passed.path("id").textValue())))
                .containsEntry("transcript", "안녕하세요").containsEntry("transcript_source", "stt").containsEntry("matched", true);

        JsonNode rejected = upload(bearer, session, UUID.randomUUID(), script.dialogue(1), 2, "audio/mp4", M4A, 1000, "none", "글자", null, 422);
        assertThat(rejected.path("detail").isArray()).isTrue();
    }

    @Test
    @DisplayName("reading.recording: 회차 상세 조회 — \"내 대사 4개 중 2개 녹음\" 의 수가 맞고 줄 순서 목록에 재생 주소가 있다. 목록 재조회 — 새 만료 시각")
    void readingRecording_detailListsRecordingsInLineOrderWithPlaybackUrls() throws Exception {
        upload(bearer, session, UUID.randomUUID(), script.dialogue(7), 1, "audio/mp4", M4A, 41_000, "none", null, null, 201);
        upload(bearer, session, UUID.randomUUID(), script.dialogue(1), 1, "audio/mp4", M4A, 20_000, "none", null, null, 201);

        JsonNode detail = json(get("/v2/reading/sessions/{id}", session), 200);

        assertThat(detail.path("my_dialogue_count").intValue()).isEqualTo(4);
        assertThat(detail.path("recorded_line_count").intValue()).isEqualTo(2);
        assertThat(detail.path("recordings")).extracting(row -> row.path("line_id").textValue())
                .as("줄 순서").containsExactly(script.dialogue(1).toString(), script.dialogue(7).toString());
        JsonNode first = detail.path("recordings").get(0);
        assertThat(first.path("playback_url").textValue()).startsWith("https://storage.test/get/reading/" + member + "/" + session + "/");
        assertThat(Instant.parse(first.path("playback_expires_at").textValue())).isEqualTo(clock.instant().plusSeconds(600));
        assertThat(first.path("duration_ms").intValue()).isEqualTo(20_000);

        clock.advance(Duration.ofMinutes(11));
        JsonNode again = json(get("/v2/reading/sessions/{id}", session), 200);
        assertThat(Instant.parse(again.path("recordings").get(0).path("playback_expires_at").textValue()))
                .as("재조회하면 새 주소·새 만료 시각").isEqualTo(clock.instant().plusSeconds(600));
    }

    @Test
    @DisplayName("reading.recording: 개별 녹음 삭제 — 그 행·객체가 없고 회차 진행·암기 상태는 그대로다. 남의 녹음·두 번째 삭제 — 404 recording_not_found")
    void readingRecording_deletingOneRecordingLeavesProgressAndMemorization() throws Exception {
        JsonNode kept = upload(bearer, session, UUID.randomUUID(), script.dialogue(1), 1, "audio/mp4", M4A, 1000, "none", null, null, 201);
        JsonNode removed = upload(bearer, session, UUID.randomUUID(), script.dialogue(3), 1, "audio/mp4", M4A, 1000, "none", null, null, 201);
        json(patch("/v2/reading/sessions/{id}/progress", session).content("{\"progress_seq\":1,\"current_line_id\":\""
                + script.dialogue(3) + "\",\"elapsed_seconds\":12}"), 200);
        jdbc.update("INSERT INTO line_memorization(id,user_id,line_id,status) VALUES (?,?,?,'memorized')",
                UUID.randomUUID(), member, script.dialogue(3));
        String others = "Bearer " + jwt.issueAccessToken(member()).value();
        var foreign = perform(delete("/v2/reading/recordings/{id}", removed.path("id").textValue()), others);
        assertThat(foreign.getStatus()).isEqualTo(404);
        assertThat(mapper.readTree(foreign.getContentAsString())).isEqualTo(mapper.readTree("{\"detail\":\"recording_not_found\"}"));

        assertThat(perform(delete("/v2/reading/recordings/{id}", removed.path("id").textValue()), bearer).getStatus()).isEqualTo(204);

        assertThat(jdbc.queryForList("SELECT id FROM reading_recordings", UUID.class))
                .containsExactly(UUID.fromString(kept.path("id").textValue()));
        assertThat(storage.objects).hasSize(1);
        assertThat(count("account_cleanup_operations")).isZero();
        JsonNode detail = json(get("/v2/reading/sessions/{id}", session), 200);
        assertThat(detail.path("current_line_id").textValue()).as("회차 진행은 그대로").isEqualTo(script.dialogue(3).toString());
        assertThat(detail.path("elapsed_seconds").intValue()).isEqualTo(12);
        assertThat(detail.path("recorded_line_count").intValue()).isEqualTo(1);
        assertThat(count("line_memorization")).as("암기 상태는 그대로").isEqualTo(1);
        assertThat(perform(delete("/v2/reading/recordings/{id}", removed.path("id").textValue()), bearer).getStatus()).isEqualTo(404);
    }

    @Test
    @DisplayName("reading.recording: 이관 처리 중 옛 게스트로 올리기 — 옛 계정에 행이 없고(404) 올린 객체는 장부가 지운다")
    void readingRecording_anUploadDuringTheTransferDoesNotLandOnTheGuest() throws Exception {
        Guest guest = consentedGuest();
        Script guests = saveScript(guest.bearer());
        UUID guestSession = startSession(guest.bearer(), guests, List.of(guests.nina), guests.dialogue(1), guests.dialogue(8));
        String code = issueCode(guest);
        holdSessionReassignments();
        ExecutorService pool = Executors.newFixedThreadPool(2);
        MockHttpServletResponse late;
        try (Connection gate = outsideConnection()) {
            try (Statement statement = gate.createStatement()) {
                statement.execute("SELECT pg_advisory_lock(" + TRANSFER_GATE + ")");
            }
            Future<Integer> transferring = pool.submit(() -> transferStatus(code));
            awaitUntil("이관이 문 앞에 서기", 1, this::lockWaiters);
            // 옛 게스트 토큰의 올리기: 사전 확인·변환·객체 올림까지 지나고 최종 저장이 회차 행에서 줄을 선다.
            Future<MockHttpServletResponse> uploading = pool.submit(() -> perform(uploadRequest(guestSession, UUID.randomUUID(),
                    guests.dialogue(1), 1, "audio/mp4", M4A, 1000, "none", null, null), guest.bearer()));
            awaitUntil("올리기가 회차 행에서 줄을 서기", 2, this::lockWaiters);
            try (Statement statement = gate.createStatement()) {
                statement.execute("SELECT pg_advisory_unlock(" + TRANSFER_GATE + ")");
            }
            assertThat(transferring.get()).isEqualTo(200);
            late = uploading.get();
        } finally {
            pool.shutdownNow();
        }
        assertThat(late.getStatus()).as(late.getContentAsString()).isEqualTo(404);
        assertThat(mapper.readTree(late.getContentAsString())).isEqualTo(mapper.readTree("{\"detail\":\"session_not_found\"}"));
        assertThat(count("reading_recordings")).isZero();
        assertThat(storage.objects).as("올렸던 객체는 장부가 지웠다").isEmpty();
        assertThat(count("account_cleanup_operations")).isZero();
    }

    @Test
    @DisplayName("reading.recording: 칸이 빠지거나 모양이 틀린 multipart — 422 배열. X-Request-Id 가 본문과 다르면 422 배열")
    void readingRecording_malformedUploadsAreValidationErrors() throws Exception {
        List<MockMultipartHttpServletRequestBuilder> malformed = List.of(
                uploadRequest(session, UUID.randomUUID(), script.dialogue(1), 1, "audio/mp4", null, 1000, "none", null, null),
                uploadRequest(session, null, script.dialogue(1), 1, "audio/mp4", M4A, 1000, "none", null, null),
                uploadRequest(session, UUID.randomUUID(), null, 1, "audio/mp4", M4A, 1000, "none", null, null),
                uploadRequest(session, UUID.randomUUID(), script.dialogue(1), 0, "audio/mp4", M4A, 1000, "none", null, null),
                uploadRequest(session, UUID.randomUUID(), script.dialogue(1), 1, "audio/mp4", M4A, -1, "none", null, null),
                uploadRequest(session, UUID.randomUUID(), script.dialogue(1), 1, "audio/mp4", M4A, 1000, "typed", null, null),
                uploadRequest(session, UUID.randomUUID(), script.dialogue(1), 1, "audio/mp4", M4A, 1000, "stt", "글", "yes"),
                uploadRequest(session, UUID.randomUUID(), script.dialogue(1), 1, "audio/mp4", M4A, 1000, null, null, null));
        for (MockMultipartHttpServletRequestBuilder request : malformed) {
            var response = perform(request, bearer);
            assertThat(response.getStatus()).as(response.getContentAsString()).isEqualTo(422);
            assertThat(mapper.readTree(response.getContentAsString()).path("detail").isArray()).isTrue();
        }
        var notUuid = perform(multipart("/v2/reading/sessions/{id}/recordings", session)
                .file(new MockMultipartFile("audio", "line.m4a", "audio/mp4", M4A))
                .param("request_id", "not-a-uuid").param("line_id", script.dialogue(1).toString()).param("attempt_no", "1")
                .param("duration_ms", "1000").param("transcript_source", "none"), bearer);
        assertThat(notUuid.getStatus()).isEqualTo(422);
        assertThat(mapper.readTree(notUuid.getContentAsString()).path("detail").get(0).path("loc")).extracting(JsonNode::asText)
                .containsExactly("body", "request_id");
        var mismatch = perform(uploadRequest(session, UUID.randomUUID(), script.dialogue(1), 1, "audio/mp4", M4A, 1000, "none", null, null)
                .header("X-Request-Id", UUID.randomUUID().toString()), bearer);
        assertThat(mismatch.getStatus()).isEqualTo(422);
        assertThat(mapper.readTree(mismatch.getContentAsString()).path("detail").get(0).path("loc")).extracting(JsonNode::asText)
                .containsExactly("header", "X-Request-Id");
        assertThat(count("reading_recordings")).isZero();
        assertThat(storage.objects).isEmpty();
    }

    // ---- helpers ----

    private JsonNode upload(
            String authorization, UUID sessionId, UUID requestId, UUID lineId, int attemptNo, String contentType, byte[] bytes,
            int durationMs, String transcriptSource, String transcript, String matched, int status) throws Exception {
        var response = perform(uploadRequest(sessionId, requestId, lineId, attemptNo, contentType, bytes, durationMs, transcriptSource,
                transcript, matched).header("X-Request-Id", requestId == null ? "" : requestId.toString()), authorization);
        assertThat(response.getStatus()).as(response.getContentAsString()).isEqualTo(status);
        return mapper.readTree(response.getContentAsString());
    }

    private MockMultipartHttpServletRequestBuilder uploadRequest(
            UUID sessionId, UUID requestId, UUID lineId, Integer attemptNo, String contentType, byte[] bytes, Integer durationMs,
            String transcriptSource, String transcript, String matched) {
        MockMultipartHttpServletRequestBuilder request = multipart("/v2/reading/sessions/{id}/recordings", sessionId);
        if (bytes != null) {
            request.file(new MockMultipartFile("audio", "line." + (contentType.contains("webm") ? "webm" : "m4a"), contentType, bytes));
        }
        if (requestId != null) {
            request.param("request_id", requestId.toString());
        }
        if (lineId != null) {
            request.param("line_id", lineId.toString());
        }
        if (attemptNo != null) {
            request.param("attempt_no", attemptNo.toString());
        }
        if (durationMs != null) {
            request.param("duration_ms", durationMs.toString());
        }
        if (transcriptSource != null) {
            request.param("transcript_source", transcriptSource);
        }
        if (transcript != null) {
            request.param("transcript", transcript);
        }
        if (matched != null) {
            request.param("matched", matched);
        }
        return request;
    }

    /** 총량 검사를 위한 저장된 녹음 — 객체 없이 바이트 수만 있다. */
    private void seedRecording(UUID owner, UUID sessionId, UUID line, long byteSize) {
        String key = "reading/seed/" + UUID.randomUUID() + ".m4a";
        jdbc.update("""
                INSERT INTO reading_recordings(id,user_id,reading_session_id,line_id,request_id,attempt_no,object_key,
                                               content_type,byte_size,duration_ms,transcript_source)
                VALUES (?,?,?,?,?,1,?,'audio/mp4',?,1500,'none')
                """, UUID.randomUUID(), owner, sessionId, line, UUID.randomUUID(), key, byteSize);
        storage.objects.put(key, byteSize);
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

    private UUID startSession(String authorization, Script target, List<UUID> characters, UUID startLine, UUID endLine) throws Exception {
        ObjectNode body = mapper.createObjectNode();
        body.put("request_id", UUID.randomUUID().toString());
        ArrayNode ids = body.putArray("my_character_ids");
        characters.forEach(id -> ids.add(id.toString()));
        body.put("mode", "read");
        body.put("start_line_id", startLine.toString());
        body.put("end_line_id", endLine.toString());
        body.put("advance", "silence");
        body.put("record", true);
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

    private Guest consentedGuest() throws Exception {
        var response = mvc.perform(post("/v2/auth/guest").with(request -> {
            request.setRemoteAddr("10.51." + ADDRESSES.incrementAndGet() + ".1");
            return request;
        })).andReturn().getResponse();
        assertThat(response.getStatus()).isEqualTo(201);
        JsonNode body = mapper.readTree(response.getContentAsString());
        Guest guest = new Guest(UUID.fromString(body.path("user").path("id").textValue()), "Bearer " + body.path("access_token").textValue());
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

    private Connection outsideConnection() throws Exception {
        return DriverManager.getConnection(PostgresContainerSupport.jdbcUrlFor(database),
                PostgresContainerSupport.POSTGRES.getUsername(), PostgresContainerSupport.POSTGRES.getPassword());
    }

    /** 이관이 회차의 주인을 바꾸는 문장이 문(advisory lock) 앞에서 멈추게 한다. 행 잠금은 이미 잡힌 뒤다. */
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
    static class Fixture {
        @Bean
        @Primary
        FakeStorage fakeStorage() {
            return new FakeStorage();
        }

        @Bean
        @Primary
        FakeFfmpeg fakeFfmpeg() {
            return new FakeFfmpeg();
        }

        /** ffmpeg 를 흉내 내는 실행기 — 출력 자리에 고정 바이트를 쓰거나, 켜 두면 실패한다. */
        @Bean
        @Primary
        AudioTranscoder fakeAudioTranscoder(FakeFfmpeg fake) {
            return new AudioTranscoder(fake);
        }
    }

    static final class FakeFfmpeg implements AudioTranscoder.CommandRunner {
        static final byte[] OUTPUT = "converted-m4a".getBytes(StandardCharsets.UTF_8);
        final AtomicBoolean failing = new AtomicBoolean();
        final List<List<String>> commands = new java.util.concurrent.CopyOnWriteArrayList<>();

        @Override
        public void run(List<String> command, Duration timeout) throws Exception {
            commands.add(command);
            if (failing.get()) {
                throw new IOException("ffmpeg exited with status 1");
            }
            Files.write(Path.of(command.getLast()), OUTPUT);
        }
    }

    /** 메모리의 오브젝트 스토리지. 무엇이 어떤 형식으로 남아 있는지만 안다. {@link #failing} 에 든 키는 지워지지 않는다. */
    static final class FakeStorage implements ObjectStorage {
        final Map<String, Long> objects = new ConcurrentHashMap<>();
        final Map<String, String> contentTypes = new ConcurrentHashMap<>();
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
            return size == null ? null : new StoredObjectMetadata(size, contentTypes.getOrDefault(objectKey, "audio/mp4"), "etag");
        }

        @Override
        public StoredObjectMetadata downloadToPath(String objectKey, Path destination) {
            throw new UnsupportedOperationException();
        }

        @Override
        public void upload(String objectKey, String mimeType, Path source) {
            try {
                objects.put(objectKey, Files.size(source));
                contentTypes.put(objectKey, mimeType);
            } catch (IOException failure) {
                throw new java.io.UncheckedIOException(failure);
            }
        }

        @Override
        public void delete(String objectKey) {
            if (failing.contains(objectKey)) {
                throw new IllegalStateException("storage refused the delete");
            }
            objects.remove(objectKey);
            contentTypes.remove(objectKey);
        }
    }
}
