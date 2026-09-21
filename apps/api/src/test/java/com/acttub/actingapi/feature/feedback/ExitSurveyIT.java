package com.acttub.actingapi.feature.feedback;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

import com.acttub.actingapi.feature.auth.app.JwtService;
import com.acttub.actingapi.feature.feedback.app.ExitSurveySheet;
import com.acttub.actingapi.feature.feedback.app.ExitSurveyStore.SheetRow;
import com.acttub.actingapi.feature.feedback.app.ExitSurveySync;
import com.acttub.actingapi.feature.profile.app.ProfileService;
import com.acttub.actingapi.support.AccountFixtures;
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
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

/**
 * practice.feedback 의 「검증 방법」 가운데 <b>서버</b> 항목을 HTTP 와 실제 Postgres 로 본다 — 접수·멱등·
 * 한 번만 묻기의 선점·시트 복제·연락처 파기다.
 *
 * <p>시트는 스텁이다. 스텁이 흉내 내는 것은 계약 둘뿐이다: 설문 id 로 한 줄, 그리고 <b>순번이 작은 전송은
 * 무시</b>한다.
 */
@SpringBootTest(properties = {
    "JWT_SECRET=test-secret",
    "ACCOUNT_CLEANUP_ENABLED=false",
    "ACCOUNT_HOUSEKEEPING_ENABLED=false",
    "ANALYSIS_WORKER_ENABLED=false",
    "EXIT_SURVEY_SYNC_ENABLED=false"
})
@AutoConfigureMockMvc
@Import(ExitSurveyIT.Fixture.class)
class ExitSurveyIT {

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        String name = PostgresContainerSupport.createDatabaseName("exit_survey");
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
    RecordingSheet sheet;
    @Autowired
    ExitSurveySync sync;
    @Autowired
    MutableClock clock;
    @Autowired
    ProfileService accounts;

    private UUID member;
    private String bearer;
    private UUID practice;

    @BeforeEach
    void setUp() {
        jdbc.execute("TRUNCATE TABLE users RESTART IDENTITY CASCADE");
        sheet.reset();
        clock.set(Instant.parse("2026-09-21T00:00:00Z"));
        member = member();
        bearer = "Bearer " + jwt.issueAccessToken(member).value();
        practice = practice(member);
    }

    @Test
    @DisplayName("practice.feedback: 대화에서 x 로 나가며 보내기 — practice_feedback 1행(screen coach, trigger x, "
            + "body, user_id, practice_id)이고 시트에 같은 id 한 줄이다. report 화면의 leave·back 도 그 값으로 남는다")
    void practiceFeedback_storesTheSurveyAndCopiesItToTheSheet() throws Exception {
        UUID id = UUID.fromString(json(submit(body("coach", "x", "오늘은 좀 나아졌어요")), 201).path("id").textValue());

        Map<String, Object> row = jdbc.queryForMap("SELECT * FROM practice_feedback WHERE id=?", id);
        assertThat(row.get("screen")).isEqualTo("coach");
        assertThat(row.get("trigger")).isEqualTo("x");
        assertThat(row.get("body")).isEqualTo("오늘은 좀 나아졌어요");
        assertThat(row.get("user_id")).isEqualTo(member);
        assertThat(row.get("practice_id")).isEqualTo(practice);
        assertThat(row.get("sheet_synced_at")).isNotNull();
        assertThat(sheet.rows()).containsOnlyKeys(id);
        assertThat(sheet.rows().get(id).body()).isEqualTo("오늘은 좀 나아졌어요");

        perform(submit(body("report", "leave", "괜찮았어요")), 201);
        perform(submit(body("report", "back", "또 올게요")), 201);
        assertThat(jdbc.queryForList("SELECT screen,trigger FROM practice_feedback ORDER BY created_at"))
                .extracting(entry -> entry.get("screen") + ":" + entry.get("trigger"))
                .containsExactly("coach:x", "report:leave", "report:back");
    }

    @Test
    @DisplayName("practice.feedback: 그냥 나가기는 body 없는 행으로 남고, 한 계정에 한 번만 묻는다 — 두 기기가 "
            + "동시에 자동 노출 조건이어도 선점한 하나만 시트를 띄운다")
    void practiceFeedback_asksOncePerAccount() throws Exception {
        assertThat(json(get("/v2/me/practice-feedback/status"), 200).path("asked").booleanValue()).isFalse();

        JsonNode first = json(post("/v2/me/practice-feedback/claim"), 200);
        JsonNode second = json(post("/v2/me/practice-feedback/claim"), 200);
        assertThat(first.path("asked_now").booleanValue()).isTrue();
        assertThat(second.path("asked_now").booleanValue()).isFalse();
        assertThat(json(get("/v2/me/practice-feedback/status"), 200).path("asked").booleanValue()).isTrue();
        assertThat(jdbc.queryForObject("SELECT exit_survey_asked_at FROM users WHERE id=?", Object.class, member))
                .isNotNull();

        UUID dismissed = UUID.fromString(json(submit(body("coach", "back", null)), 201).path("id").textValue());
        assertThat(jdbc.queryForObject("SELECT body FROM practice_feedback WHERE id=?", String.class, dismissed))
                .isNull();
    }

    @Test
    @DisplayName("practice.feedback: 본문은 다듬은 뒤 1~100자다 — 빈 본문은 422, 100자는 201, 101자는 422, "
            + "연락처는 80자까지이고 없이도 보낼 수 있다")
    void practiceFeedback_validatesBodyAndContacts() throws Exception {
        perform(submit(body("coach", "x", "   ")), 422);
        perform(submit(body("coach", "x", "가".repeat(100))), 201);
        perform(submit(body("coach", "x", "가".repeat(101))), 422);
        perform(submit(contactBody("a".repeat(70) + "@acttub.kr")), 201);
        perform(submit(contactBody("a".repeat(75) + "@acttub.kr")), 422);
        perform(submit(body("coach", "x", "연락처 없이")), 201);

        UUID stranger = member();
        UUID theirPractice = practice(stranger);
        assertThat(mapper.readTree(perform(
                        post("/v2/practice-feedback").content(
                                "{\"request_id\":\"%s\",\"practice_id\":\"%s\",\"screen\":\"coach\","
                                        .formatted(UUID.randomUUID(), theirPractice)
                                        + "\"trigger\":\"x\",\"body\":\"남의 회차\"}"),
                        404)
                .getContentAsString()))
                .isEqualTo(mapper.readTree("{\"detail\":\"practice_not_found\"}"));
    }

    @Test
    @DisplayName("practice.feedback: 같은 request_id 의 재전송은 행을 늘리지 않고 같은 설문 id 를 돌려준다 — "
            + "오프라인에서 들고 있다 다시 보내도 시트에 한 줄이다")
    void practiceFeedback_isIdempotentPerRequestId() throws Exception {
        UUID requestId = UUID.randomUUID();
        String payload = body(requestId, "coach", "x", "오프라인에서 썼어요", null);

        UUID first = UUID.fromString(json(submit(payload), 201).path("id").textValue());
        UUID again = UUID.fromString(json(submit(payload), 200).path("id").textValue());

        assertThat(again).isEqualTo(first);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM practice_feedback", Integer.class)).isEqualTo(1);
        assertThat(sheet.rows()).containsOnlyKeys(first);
    }

    @Test
    @DisplayName("practice.feedback: 시트 전송이 실패하면 접수는 유지되고 sheet_synced_at 이 NULL 로 남아 "
            + "다음 날 도는 일이 다시 보낸다")
    void practiceFeedback_failedSheetSyncIsRetriedTheNextDay() throws Exception {
        sheet.fail(true);
        UUID id = UUID.fromString(json(submit(body("coach", "x", "시트가 죽었어요")), 201).path("id").textValue());

        assertThat(jdbc.queryForObject(
                "SELECT sheet_synced_at FROM practice_feedback WHERE id=?", Object.class, id)).isNull();
        assertThat(sheet.rows()).isEmpty();

        sheet.fail(false);
        clock.advance(Duration.ofDays(1));
        assertThat(sync.runDaily()).isEqualTo(1);

        assertThat(jdbc.queryForObject(
                "SELECT sheet_synced_at FROM practice_feedback WHERE id=?", Object.class, id)).isNotNull();
        assertThat(sheet.rows()).containsOnlyKeys(id);
    }

    @Test
    @DisplayName("practice.feedback: 접수 91일 뒤에는 DB 연락처가 NULL 이고 시트의 같은 id 줄에도 연락처가 없다. "
            + "오래된 순번의 전송이 늦게 도착해도 시트의 연락처가 되살아나지 않는다")
    void practiceFeedback_contactsArePurgedAfterNinetyDays() throws Exception {
        UUID id = UUID.fromString(json(submit(contactBody("actor@acttub.kr")), 201).path("id").textValue());
        SheetRow stale = sheet.rows().get(id);
        assertThat(stale.contactEmail()).isEqualTo("actor@acttub.kr");

        clock.advance(Duration.ofDays(91));
        sync.runDaily();

        Map<String, Object> row = jdbc.queryForMap("SELECT * FROM practice_feedback WHERE id=?", id);
        assertThat(row.get("contact_email")).isNull();
        assertThat(row.get("contact_phone")).isNull();
        assertThat(row.get("body")).isNotNull();
        assertThat(sheet.rows().get(id).contactEmail()).isNull();

        // 오래된 순번의 전송이 뒤늦게 도착한다.
        sheet.upsert(stale);
        assertThat(sheet.rows().get(id).contactEmail()).isNull();
    }

    @Test
    @DisplayName("practice.feedback: 탈퇴하면 연락처가 DB 와 시트에서 사라지고 본문은 탈퇴한 계정에 매달려 남는다")
    void practiceFeedback_withdrawalPurgesContactsButKeepsTheBody() throws Exception {
        UUID id = UUID.fromString(json(submit(contactBody("actor@acttub.kr")), 201).path("id").textValue());

        accounts.withdraw(member);
        sync.runDaily();

        Map<String, Object> row = jdbc.queryForMap("SELECT * FROM practice_feedback WHERE id=?", id);
        assertThat(row.get("contact_email")).isNull();
        assertThat(row.get("contact_phone")).isNull();
        assertThat(row.get("body")).isEqualTo("연락 주세요");
        assertThat(row.get("user_id")).isEqualTo(member);
        assertThat(jdbc.queryForObject("SELECT status FROM users WHERE id=?", String.class, member))
                .isEqualTo("deactivated");
        assertThat(sheet.rows().get(id).contactEmail()).isNull();
    }

    // --- 도우미 -------------------------------------------------------------

    private MockHttpServletRequestBuilder submit(String payload) {
        return post("/v2/practice-feedback").content(payload);
    }

    private String body(String screen, String trigger, String text) {
        return body(UUID.randomUUID(), screen, trigger, text, null);
    }

    private String contactBody(String email) {
        return body(UUID.randomUUID(), "coach", "x", "연락 주세요", email);
    }

    private String body(UUID requestId, String screen, String trigger, String text, String email) {
        StringBuilder payload = new StringBuilder("{\"request_id\":\"%s\",\"practice_id\":\"%s\","
                .formatted(requestId, practice));
        payload.append("\"screen\":\"%s\",\"trigger\":\"%s\"".formatted(screen, trigger));
        if (text != null) {
            payload.append(",\"body\":\"%s\"".formatted(text));
        }
        if (email != null) {
            payload.append(",\"contact_email\":\"%s\"".formatted(email));
        }
        return payload.append("}").toString();
    }

    private UUID member() {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO users(id,status) VALUES (?,'active')", id);
        jdbc.update("INSERT INTO user_identities(id,user_id,provider,provider_uid) VALUES (?,?,'google',?)",
                UUID.randomUUID(), id, "g-" + id);
        AccountFixtures.passGate(jdbc, id);
        return id;
    }

    private UUID practice(UUID owner) {
        UUID videoId = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO videos(id,user_id,object_key,content_type,byte_size,duration_ms)
                VALUES (?,?,?,'video/mp4',1000,12000)
                """, videoId, owner, "videos/" + owner + "/" + videoId + ".mp4");
        UUID id = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO practices(id,user_id,video_id,root_id,ordinal,stage,experience_version,
                                      blockage_kind,sub_branch,situation)
                VALUES (?,?,?,?,1,'conversing','legacy','표현','감정','문 앞에서 돌아선다')
                """, id, owner, videoId, id);
        return id;
    }

    private JsonNode json(MockHttpServletRequestBuilder request, int status) throws Exception {
        return mapper.readTree(perform(request, status).getContentAsString());
    }

    private MockHttpServletResponse perform(MockHttpServletRequestBuilder request, int status) throws Exception {
        MockHttpServletResponse response = mvc.perform(request
                        .header("Authorization", bearer)
                        .contentType(MediaType.APPLICATION_JSON))
                .andReturn()
                .getResponse();
        assertThat(response.getStatus()).isEqualTo(status);
        return response;
    }

    @TestConfiguration
    static class Fixture {
        @Bean
        @Primary
        RecordingSheet recordingSheet() {
            return new RecordingSheet();
        }

        @Bean
        @Primary
        MutableClock mutableClock() {
            return new MutableClock(Instant.parse("2026-09-21T00:00:00Z"));
        }
    }

    /** 시트의 계약 둘만 흉내 낸다 — 설문 id 로 한 줄, 순번이 작은 전송은 무시. */
    static final class RecordingSheet implements ExitSurveySheet {
        private final Map<UUID, SheetRow> rows = new LinkedHashMap<>();
        private volatile boolean failing;

        @Override
        public synchronized void upsert(SheetRow row) {
            if (failing) {
                throw new IllegalStateException("sheet is unreachable");
            }
            SheetRow current = rows.get(row.id());
            if (current != null && current.seq() > row.seq()) {
                return;
            }
            rows.put(row.id(), row);
        }

        synchronized Map<UUID, SheetRow> rows() {
            return Map.copyOf(rows);
        }

        void fail(boolean failing) {
            this.failing = failing;
        }

        synchronized void reset() {
            rows.clear();
            failing = false;
        }
    }
}
