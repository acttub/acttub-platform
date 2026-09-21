package com.acttub.actingapi.feature.reading;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;

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
import java.time.ZoneId;
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
import com.acttub.actingapi.feature.profile.app.AccountCleanup;
import com.acttub.actingapi.feature.profile.app.AccountHousekeeping;
import com.acttub.actingapi.integration.storage.ObjectStorage;
import com.acttub.actingapi.integration.storage.StoredObjectMetadata;
import com.acttub.actingapi.platform.security.AccountSecrets;
import com.acttub.actingapi.support.AccountFixtures;
import com.acttub.actingapi.support.MutableClock;
import com.acttub.actingapi.support.PostgresContainerSupport;
import com.acttub.actingapi.support.RecordingFailureReporter;
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

/**
 * 리딩 자료의 생애 — 03-reading 「리딩 자료의 이관·삭제·탈퇴」 표와 account.guest·account.withdraw 의 리딩 항목을 HTTP 와
 * 실제 Postgres 로 본다. 이관·탈퇴·30일 파기·3년 파기·정리 장부의 7일 규칙이 여기 있다. 대본·회차 삭제는 각 기능의 IT 가 본다.
 *
 * <p>오브젝트 스토리지는 메모리의 가짜이고, 매일 도는 일은 스케줄러를 끄고 {@link AccountHousekeeping#runDaily} 를 직접 부른다.
 * 여기서 보지 못하는 것: 보관 동의 철회(운영자가 DB 에서 직접 처리하는 절차, 운영 문서), 기기 자료 삭제(앱·웹).
 */
@SpringBootTest(properties = {
    "JWT_SECRET=test-secret",
    "ACCOUNT_CLEANUP_ENABLED=false",
    "ACCOUNT_HOUSEKEEPING_ENABLED=false",
    // 탈퇴 중의 쓰기는 저마다 커넥션을 쥔 채 잠금을 기다린다.
    "spring.datasource.hikari.maximum-pool-size=12"
})
@AutoConfigureMockMvc
@Import({MutableClock.Fixture.class, ReadingLifecycleIT.Fixture.class})
class ReadingLifecycleIT {
    private static final AtomicInteger ADDRESSES = new AtomicInteger();
    private static final ZoneId SEOUL = ZoneId.of("Asia/Seoul");
    private static final long WITHDRAW_GATE = 546_005L;
    private static final OffsetDateTime PUBLISHED = OffsetDateTime.of(2026, 10, 1, 0, 0, 0, 0, ZoneOffset.UTC);
    private static final byte[] M4A = "m4a-bytes".getBytes(StandardCharsets.UTF_8);
    private static String database;

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        String name = PostgresContainerSupport.createDatabaseName("reading_lifecycle");
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
    AccountSecrets secrets;

    @Autowired
    AccountCleanup cleanup;

    @Autowired
    AccountHousekeeping housekeeping;

    @Autowired
    FakeStorage storage;

    @Autowired
    RecordingFailureReporter failures;

    private final Map<String, UUID> documents = new LinkedHashMap<>();
    private String address;

    @BeforeEach
    void setUp() {
        jdbc.execute("DROP TRIGGER IF EXISTS hold_memorization_delete ON line_memorization");
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
        failures.clear();
        clock.set(Instant.now().truncatedTo(java.time.temporal.ChronoUnit.SECONDS));
        address = "10.54.0." + ADDRESSES.incrementAndGet();
    }

    @Test
    @DisplayName("account.withdraw·reading.script·reading.recording·reading.memorization: 보관에 동의하지 않은 사람이 탈퇴 — scripts·배역·줄·회차·"
            + "녹음(행·객체·전사)·line_memorization 이 없고 장부는 비어 있다. 옛 토큰의 리딩 요청은 403 account_deactivated")
    void readingLifecycle_withdrawalWithoutRetentionErasesEverything() throws Exception {
        Actor actor = member(false);
        Reading reading = reading(actor.bearer(), "안녕하세요");
        Script other = saveScript(actor.bearer());
        mark(actor.bearer(), other.dialogue(2));
        assertThat(storage.objects).hasSize(2);

        MockHttpServletResponse withdrawn = perform(delete("/v2/me"), actor.bearer());

        assertThat(withdrawn.getStatus()).as(withdrawn.getContentAsString()).isEqualTo(200);
        assertThat(jdbc.queryForObject("SELECT status FROM users WHERE id=?", String.class, actor.id())).isEqualTo("deactivated");
        assertThat(ownedRows(actor.id())).as("scripts, sessions, recordings, memorization").containsExactly(0, 0, 0, 0);
        assertThat(count("script_characters")).isZero();
        assertThat(count("script_lines")).isZero();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM reading_recordings WHERE transcript IS NOT NULL", Integer.class))
                .as("동의하지 않은 사람의 전사는 녹음과 함께 지운다").isZero();
        assertThat(storage.objects).as("녹음 객체는 장부가 바로 지웠다").isEmpty();
        assertThat(count("account_cleanup_operations")).isZero();
        MockHttpServletResponse stale = perform(get("/v2/reading/scripts/{id}/memorization", reading.script().id), actor.bearer());
        assertThat(stale.getStatus()).isEqualTo(403);
        assertThat(mapper.readTree(stale.getContentAsString()).path("detail").textValue()).isEqualTo("account_deactivated");
        // 다시 온 탈퇴는 지울 것이 없고 같은 답이다.
        assertThat(perform(delete("/v2/me"), actor.bearer()).getStatus()).isEqualTo(200);
    }

    @Test
    @DisplayName("account.withdraw·reading.recording: 보관 동의자 탈퇴 — 녹음 행이 남고 user_id 그대로, reading_session_id·line_id 가 NULL, "
            + "객체·전사가 있다. 대본·회차·암기 상태는 없다. 보관 행은 일반 조회 API 에 나오지 않는다. 3년 뒤 — 행·객체가 없다")
    void readingLifecycle_retentionConsentKeepsRecordingsForThreeYears() throws Exception {
        Actor actor = member(true);
        Reading reading = reading(actor.bearer(), "안녕하세요");
        Instant withdrawnAt = clock.instant();

        assertThat(perform(delete("/v2/me"), actor.bearer()).getStatus()).isEqualTo(200);

        assertThat(ownedRows(actor.id())).as("scripts, sessions, recordings, memorization").containsExactly(0, 0, 2, 0);
        assertThat(jdbc.queryForList("SELECT reading_session_id,line_id,transcript,object_key FROM reading_recordings ORDER BY created_at"))
                .allSatisfy(row -> {
                    assertThat(row.get("reading_session_id")).isNull();
                    assertThat(row.get("line_id")).isNull();
                    assertThat(storage.objects).containsKey((String) row.get("object_key"));
                })
                .extracting(row -> row.get("transcript")).as("전사는 음성과 함께 남는다").containsExactly("안녕하세요", null);
        assertThat(storage.objects).hasSize(2);
        assertThat(count("account_cleanup_operations")).isZero();
        MockHttpServletResponse stale = perform(get("/v2/reading/sessions/{id}", reading.session()), actor.bearer());
        assertThat(stale.getStatus()).as("닫힌 계정의 토큰으로는 아무것도 보이지 않는다").isEqualTo(403);

        clock.set(withdrawnAt.atZone(SEOUL).plusYears(3).minusDays(1).toInstant());
        housekeeping.runDaily();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM reading_recordings WHERE user_id=?", Integer.class, actor.id()))
                .as("3년이 안 됐다").isEqualTo(2);
        assertThat(storage.objects).hasSize(2);

        clock.set(withdrawnAt.atZone(SEOUL).plusYears(3).plusDays(1).toInstant());
        housekeeping.runDaily();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM reading_recordings WHERE user_id=?", Integer.class, actor.id())).isZero();
        assertThat(storage.objects).isEmpty();
        assertThat(count("account_cleanup_operations")).isZero();
        assertThat(jdbc.queryForObject("SELECT retention_purged_at FROM users WHERE id=?", OffsetDateTime.class, actor.id())).isNotNull();
    }

    @Test
    @DisplayName("account.guest·reading.recording: 마지막 활동 31일 지난 게스트 — 파기 뒤 리딩 행·객체·전사가 없고 users 행은 deactivated 다. "
            + "대본 등록·회차 진행·녹음 올리기·암기 갱신 가운데 하나라도 사흘 전이면 마지막 활동이라 그대로다")
    void readingLifecycle_idleGuestsArePurgedAndReadingWritesCountAsActivity() throws Exception {
        Instant now = clock.instant();
        Instant longAgo = now.minus(Duration.ofDays(40));
        Instant idle = now.minus(Duration.ofDays(31));
        Instant recent = now.minus(Duration.ofDays(3));
        Map<String, Guest> guests = new LinkedHashMap<>();
        for (String name : List.of("idle", "scripted", "practised", "recorded", "memorized")) {
            Guest guest = consentedGuest();
            reading(guest.bearer(), null);
            guests.put(name, guest);
        }
        for (Guest guest : guests.values()) {
            backdate(guest.id(), longAgo, idle);
        }
        jdbc.update("UPDATE scripts SET created_at=? WHERE user_id=?", at(recent), guests.get("scripted").id());
        jdbc.update("UPDATE reading_sessions SET updated_at=? WHERE user_id=?", at(recent), guests.get("practised").id());
        jdbc.update("UPDATE reading_recordings SET updated_at=? WHERE user_id=?", at(recent), guests.get("recorded").id());
        jdbc.update("UPDATE line_memorization SET updated_at=? WHERE user_id=?", at(recent), guests.get("memorized").id());
        assertThat(storage.objects).hasSize(10);

        housekeeping.runDaily();

        UUID purged = guests.get("idle").id();
        assertThat(jdbc.queryForObject("SELECT status FROM users WHERE id=?", String.class, purged)).isEqualTo("deactivated");
        assertThat(ownedRows(purged)).containsExactly(0, 0, 0, 0);
        assertThat(storage.objects).as("파기된 게스트의 객체 둘만 없다").hasSize(8);
        assertThat(count("account_cleanup_operations")).isZero();
        for (String name : List.of("scripted", "practised", "recorded", "memorized")) {
            UUID kept = guests.get(name).id();
            assertThat(jdbc.queryForObject("SELECT status FROM users WHERE id=?", String.class, kept)).as(name).isEqualTo("active");
            assertThat(ownedRows(kept)).as(name).containsExactly(1, 1, 2, 1);
        }
    }

    @Test
    @DisplayName("reading.recording·account.withdraw: 객체 삭제가 계속 실패 — 7일 뒤에도 장부에 키가 남고 운영자 알림이 한 번 있다. 그 뒤 성공하면 "
            + "객체와 장부 행이 없다. 제공자 해제 값은 7일 뒤 지운다")
    void readingLifecycle_objectDeletionThatKeepsFailingKeepsTheKeysAndAlerts() throws Exception {
        Actor actor = member(false);
        Reading reading = reading(actor.bearer(), null);
        List<String> keys = jdbc.queryForList("SELECT object_key FROM reading_recordings ORDER BY created_at", String.class);
        storage.failing.addAll(keys);
        jdbc.update("""
                INSERT INTO account_cleanup_operations(id,user_id,kind,payload_encrypted,next_attempt_at,expires_at,created_at)
                VALUES (?,?,'kakao_unlink',?,?,?,?)
                """, UUID.randomUUID(), actor.id(), secrets.encrypt("987654321"), at(clock.instant()),
                at(clock.instant().plus(Duration.ofDays(7))), at(clock.instant()));

        assertThat(perform(delete("/v2/me"), actor.bearer()).getStatus()).isEqualTo(200);

        assertThat(jdbc.queryForList("SELECT kind FROM account_cleanup_operations ORDER BY created_at", String.class))
                .containsExactly("kakao_unlink", "reading_recording_delete");
        assertThat(storage.objects).as("저장소가 거절해 객체는 남아 있다").hasSize(2);
        failures.clear();

        clock.advance(Duration.ofDays(7).plusSeconds(1));
        cleanup.runDue();

        assertThat(jdbc.queryForList("SELECT kind FROM account_cleanup_operations", String.class))
                .as("제공자 해제 값은 지우고 객체 삭제는 남긴다").containsExactly("reading_recording_delete");
        assertThat(secrets.decrypt(jdbc.queryForObject("SELECT payload_encrypted FROM account_cleanup_operations", String.class)))
                .as("키가 그대로다").contains(keys.get(0), keys.get(1));
        assertThat(failures.reports())
                .filteredOn(report -> report.failure() instanceof AccountCleanup.ObjectDeletionOverdue)
                .singleElement()
                .satisfies(report -> {
                    assertThat(report.context()).startsWith("AccountCleanup.objectDeletionOverdue");
                    assertThat(report.failure().getMessage()).contains("reading_recording_delete").doesNotContain(keys.get(0));
                });

        // 일주일 안에는 다시 알리지 않고 시도는 계속된다.
        clock.advance(Duration.ofDays(1));
        cleanup.runDue();
        assertThat(failures.reports()).filteredOn(report -> report.failure() instanceof AccountCleanup.ObjectDeletionOverdue).hasSize(1);
        assertThat(count("account_cleanup_operations")).isEqualTo(1);

        storage.failing.clear();
        clock.advance(Duration.ofHours(13));
        cleanup.runDue();
        assertThat(storage.objects).isEmpty();
        assertThat(count("account_cleanup_operations")).isZero();
        assertThat(reading.script()).isNotNull();
    }

    @Test
    @DisplayName("account.guest·reading.script: 게스트로 대본을 올리고 회차 하나를 끝낸 뒤 옮김 — 회원의 대본 목록에 그 대본과 회차·녹음·암기 상태가 "
            + "보이고 네 표의 user_id 가 회원이다. 옮긴 게스트의 토큰으로 온 리딩 요청은 403 guest_transferred")
    void readingLifecycle_guestReadingMovesToTheMemberWithTheCode() throws Exception {
        Actor actor = member(false);
        Guest guest = consentedGuest();
        Reading reading = reading(guest.bearer(), "안녕하세요");
        json(patch("/v2/reading/sessions/{id}/progress", reading.session())
                .content("{\"progress_seq\":9,\"current_line_id\":null,\"elapsed_seconds\":120,\"complete\":true}"), guest.bearer(), 200);

        transfer(guest, actor);

        JsonNode scripts = json(get("/v2/reading/scripts"), actor.bearer(), 200);
        assertThat(scripts.path("scripts")).hasSize(1);
        JsonNode card = scripts.path("scripts").get(0);
        assertThat(card.path("id").textValue()).isEqualTo(reading.script().id.toString());
        assertThat(card.path("status").textValue()).isEqualTo("completed");
        assertThat(card.path("recording_count").intValue()).isEqualTo(2);
        assertThat(card.path("my_character_names")).extracting(JsonNode::textValue).containsExactly("니나");
        JsonNode sessions = json(get("/v2/reading/scripts/{id}/sessions", reading.script().id), actor.bearer(), 200).path("sessions");
        assertThat(sessions).hasSize(1);
        assertThat(sessions.get(0).path("recorded_line_count").intValue()).isEqualTo(2);
        JsonNode detail = json(get("/v2/reading/sessions/{id}", reading.session()), actor.bearer(), 200);
        assertThat(detail.path("recordings")).hasSize(2);
        assertThat(detail.path("recordings").get(0).path("playback_url").textValue()).startsWith("https://storage.test/get/reading/");
        assertThat(json(get("/v2/reading/scripts/{id}/memorization", reading.script().id), actor.bearer(), 200)).hasSize(1);
        assertThat(ownedRows(actor.id())).containsExactly(1, 1, 2, 1);
        assertThat(ownedRows(guest.id())).containsExactly(0, 0, 0, 0);
        assertThat(jdbc.queryForObject("SELECT status FROM users WHERE id=?", String.class, guest.id())).isEqualTo("deactivated");
        assertThat(jdbc.queryForObject("SELECT count(*) FROM user_identities WHERE user_id=?", Integer.class, guest.id())).isZero();
        assertThat(storage.objects).as("객체는 그대로고 주인만 바뀐다").hasSize(2);
        for (MockHttpServletRequestBuilder request : List.of(
                get("/v2/reading/scripts"),
                put("/v2/reading/lines/{id}/memorization", reading.script().dialogue(3)).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"memorized\"}"))) {
            MockHttpServletResponse stale = perform(request, guest.bearer());
            assertThat(stale.getStatus()).isEqualTo(403);
            assertThat(mapper.readTree(stale.getContentAsString())).isEqualTo(mapper.readTree("{\"detail\":\"guest_transferred\"}"));
        }
    }

    @Test
    @DisplayName("account.withdraw·reading.memorization: 탈퇴 처리 중 도착한 암기 갱신 — 탈퇴가 잡은 대본 행 뒤에 줄을 서고 404 line_not_found 이며 "
            + "옛 계정에 아무것도 남지 않는다")
    void readingLifecycle_aWriteDuringWithdrawalLandsNowhere() throws Exception {
        Actor actor = member(false);
        Reading reading = reading(actor.bearer(), null);
        holdMemorizationDeletes();
        ExecutorService pool = Executors.newFixedThreadPool(2);
        MockHttpServletResponse late;
        try (Connection gate = outsideConnection()) {
            try (Statement statement = gate.createStatement()) {
                statement.execute("SELECT pg_advisory_lock(" + WITHDRAW_GATE + ")");
            }
            // 탈퇴: users 행과 이 사람의 대본·회차 행을 잡은 뒤 암기 표시를 지우려다 문 앞에서 멈춘다.
            Future<MockHttpServletResponse> withdrawing = pool.submit(() -> perform(delete("/v2/me"), actor.bearer()));
            awaitUntil("탈퇴가 문 앞에 서기", 1, this::lockWaiters);
            // 그 사이의 암기 갱신: 게이트는 지나지만(아직 활성) 대본 행에서 줄을 선다.
            Future<MockHttpServletResponse> marking = pool.submit(() -> perform(
                    put("/v2/reading/lines/{id}/memorization", reading.script().dialogue(1)).contentType(MediaType.APPLICATION_JSON)
                            .content("{\"status\":\"memorized\"}"), actor.bearer()));
            awaitUntil("갱신이 대본 행에서 줄을 서기", 2, this::lockWaiters);
            try (Statement statement = gate.createStatement()) {
                statement.execute("SELECT pg_advisory_unlock(" + WITHDRAW_GATE + ")");
            }
            assertThat(withdrawing.get().getStatus()).isEqualTo(200);
            late = marking.get();
        } finally {
            pool.shutdownNow();
        }
        assertThat(late.getStatus()).as(late.getContentAsString()).isEqualTo(404);
        assertThat(mapper.readTree(late.getContentAsString())).isEqualTo(mapper.readTree("{\"detail\":\"line_not_found\"}"));
        assertThat(ownedRows(actor.id())).containsExactly(0, 0, 0, 0);
        assertThat(storage.objects).isEmpty();
    }

    // ---- helpers ----

    private record Actor(UUID id, String bearer) {
    }

    /** 가입을 끝낸 회원. {@code retention} 이 거짓이면 보관 문서의 마지막 결정을 거절로 둔다. */
    private Actor member(boolean retention) {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO users(id,status) VALUES (?,'active')", id);
        jdbc.update("INSERT INTO user_identities(id,user_id,provider,provider_uid) VALUES (?,?,'google',?)",
                UUID.randomUUID(), id, "g-" + id);
        AccountFixtures.passGate(jdbc, id);
        if (!retention) {
            jdbc.update("""
                    INSERT INTO user_consents(id,user_id,document_id,action,occurred_at)
                    VALUES (?,?,?,'declined',now() + interval '1 minute')
                    """, UUID.randomUUID(), id, documents.get("retention"));
        }
        return new Actor(id, "Bearer " + jwt.issueAccessToken(id).value());
    }

    private record Guest(UUID id, String bearer) {
    }

    private Guest consentedGuest() throws Exception {
        var response = mvc.perform(post("/v2/auth/guest").with(request -> {
            request.setRemoteAddr("10.55." + ADDRESSES.incrementAndGet() + ".1");
            return request;
        })).andReturn().getResponse();
        assertThat(response.getStatus()).isEqualTo(201);
        JsonNode body = mapper.readTree(response.getContentAsString());
        Guest guest = new Guest(UUID.fromString(body.path("user").path("id").textValue()), "Bearer " + body.path("access_token").textValue());
        for (String type : List.of("terms", "privacy")) {
            Map<String, Object> consent = new LinkedHashMap<>();
            consent.put("document_id", documents.get(type).toString());
            consent.put("action", "granted");
            if ("terms".equals(type)) {
                consent.put("age_confirmed", true);
            }
            var consented = perform(post("/v2/consents").contentType(MediaType.APPLICATION_JSON).content(mapper.writeValueAsString(consent)),
                    guest.bearer());
            assertThat(consented.getStatus()).as(consented.getContentAsString()).isEqualTo(201);
        }
        return guest;
    }

    private record Reading(Script script, UUID session) {
    }

    /** 대본 하나, 니나로 녹음 켠 회차 하나, 내 대사 둘의 녹음(첫째는 전사 포함), 줄 하나의 암기 표시. */
    private Reading reading(String authorization, String transcript) throws Exception {
        Script script = saveScript(authorization);
        UUID session = startSession(authorization, script);
        upload(authorization, session, script.dialogue(1), transcript);
        upload(authorization, session, script.dialogue(3), null);
        mark(authorization, script.dialogue(1));
        return new Reading(script, session);
    }

    /** 이 사람이 주인인 scripts·reading_sessions·reading_recordings·line_memorization 행 수. */
    private List<Integer> ownedRows(UUID userId) {
        List<Integer> counts = new ArrayList<>();
        for (String table : List.of("scripts", "reading_sessions", "reading_recordings", "line_memorization")) {
            counts.add(jdbc.queryForObject("SELECT count(*) FROM " + table + " WHERE user_id=?", Integer.class, userId));
        }
        return counts;
    }

    /** 게스트의 시작·토큰과 리딩 행의 시각을 과거로 돌린다. */
    private void backdate(UUID userId, Instant createdAt, Instant readingAt) {
        jdbc.update("UPDATE users SET created_at=? WHERE id=?", at(createdAt), userId);
        jdbc.update("UPDATE refresh_tokens SET issued_at=? WHERE user_id=?", at(createdAt), userId);
        jdbc.update("UPDATE scripts SET created_at=?,updated_at=? WHERE user_id=?", at(readingAt), at(readingAt), userId);
        jdbc.update("UPDATE reading_sessions SET started_at=?,updated_at=? WHERE user_id=?", at(readingAt), at(readingAt), userId);
        jdbc.update("UPDATE reading_recordings SET created_at=?,updated_at=? WHERE user_id=?", at(readingAt), at(readingAt), userId);
        jdbc.update("UPDATE line_memorization SET created_at=?,updated_at=? WHERE user_id=?", at(readingAt), at(readingAt), userId);
    }

    private void upload(String authorization, UUID session, UUID line, String transcript) throws Exception {
        var request = multipart("/v2/reading/sessions/{id}/recordings", session)
                .file(new MockMultipartFile("audio", "line.m4a", "audio/mp4", M4A))
                .param("request_id", UUID.randomUUID().toString())
                .param("line_id", line.toString())
                .param("attempt_no", "1")
                .param("duration_ms", "1500")
                .param("transcript_source", transcript == null ? "none" : "stt");
        if (transcript != null) {
            request.param("transcript", transcript).param("matched", "true");
        }
        var response = perform(request, authorization);
        assertThat(response.getStatus()).as(response.getContentAsString()).isEqualTo(201);
    }

    private void mark(String authorization, UUID line) throws Exception {
        var response = perform(put("/v2/reading/lines/{id}/memorization", line).contentType(MediaType.APPLICATION_JSON)
                .content("{\"status\":\"memorized\"}"), authorization);
        assertThat(response.getStatus()).as(response.getContentAsString()).isEqualTo(200);
    }

    private record Script(UUID id, UUID nina, List<UUID> dialogues) {
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
                dialogues);
    }

    /** 니나를 내 배역으로 전체 구간·녹음 켬으로 시작한 회차. */
    private UUID startSession(String authorization, Script target) throws Exception {
        ObjectNode body = mapper.createObjectNode();
        body.put("request_id", UUID.randomUUID().toString());
        body.putArray("my_character_ids").add(target.nina.toString());
        body.put("mode", "read");
        body.put("start_line_id", target.dialogue(1).toString());
        body.put("end_line_id", target.dialogue(8).toString());
        body.put("advance", "silence");
        body.put("record", true);
        var response = perform(post("/v2/reading/scripts/{id}/sessions", target.id).contentType(MediaType.APPLICATION_JSON)
                .content(body.toString()), authorization);
        assertThat(response.getStatus()).as(response.getContentAsString()).isEqualTo(201);
        return UUID.fromString(mapper.readTree(response.getContentAsString()).path("id").textValue());
    }

    private void transfer(Guest guest, Actor actor) throws Exception {
        var issued = perform(post("/v2/guest/transfer-code"), guest.bearer());
        assertThat(issued.getStatus()).as(issued.getContentAsString()).isEqualTo(201);
        String code = mapper.readTree(issued.getContentAsString()).path("code").textValue();
        String from = address;
        var response = mvc.perform(post("/v2/guest-transfers")
                        .with(request -> {
                            request.setRemoteAddr(from);
                            return request;
                        })
                        .header("Authorization", actor.bearer())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"code\":\"" + code + "\"}"))
                .andReturn().getResponse();
        assertThat(response.getStatus()).as(response.getContentAsString()).isEqualTo(200);
    }

    private Connection outsideConnection() throws Exception {
        return DriverManager.getConnection(PostgresContainerSupport.jdbcUrlFor(database),
                PostgresContainerSupport.POSTGRES.getUsername(), PostgresContainerSupport.POSTGRES.getPassword());
    }

    /** 탈퇴가 암기 표시를 지우는 문장이 문(advisory lock) 앞에서 멈추게 한다. 대본·회차 행은 이미 잡힌 뒤다. */
    private void holdMemorizationDeletes() {
        jdbc.execute("""
                CREATE OR REPLACE FUNCTION hold_memorization_delete() RETURNS trigger AS $$
                BEGIN
                    PERFORM pg_advisory_xact_lock_shared(%d);
                    RETURN NULL;
                END
                $$ LANGUAGE plpgsql
                """.formatted(WITHDRAW_GATE));
        jdbc.execute("""
                CREATE TRIGGER hold_memorization_delete
                BEFORE DELETE ON line_memorization
                FOR EACH STATEMENT EXECUTE FUNCTION hold_memorization_delete()
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

    private JsonNode json(MockHttpServletRequestBuilder request, String authorization, int status) throws Exception {
        var response = perform(request.contentType(MediaType.APPLICATION_JSON), authorization);
        assertThat(response.getStatus()).as(response.getContentAsString()).isEqualTo(status);
        String body = response.getContentAsString();
        return body.isEmpty() ? mapper.nullNode() : mapper.readTree(body);
    }

    private int count(String table) {
        return jdbc.queryForObject("SELECT count(*) FROM " + table, Integer.class);
    }

    private static OffsetDateTime at(Instant instant) {
        return instant.atOffset(ZoneOffset.UTC);
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
        RecordingFailureReporter recordingFailureReporter() {
            return new RecordingFailureReporter();
        }
    }

    /** 메모리의 오브젝트 스토리지. 무엇이 남아 있는지만 안다. {@link #failing} 에 든 키는 지워지지 않는다. */
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
        public void upload(String objectKey, String mimeType, Path source) {
            try {
                objects.put(objectKey, Files.size(source));
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
        }
    }
}
