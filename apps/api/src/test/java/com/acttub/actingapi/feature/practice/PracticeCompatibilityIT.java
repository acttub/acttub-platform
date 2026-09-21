package com.acttub.actingapi.feature.practice;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;

import java.util.UUID;

import com.acttub.actingapi.feature.auth.app.JwtService;
import com.acttub.actingapi.platform.migration.PracticeDataMigration;
import com.acttub.actingapi.support.AccountFixtures;
import com.acttub.actingapi.support.PostgresContainerSupport;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

/**
 * 02-practice 「1.0.0 스키마 전환」 ② — <b>호환 읽기 경로</b>를 HTTP 로 본다.
 *
 * <p>넓히기와 새 쓰기 사이에는 같은 배우의 자료가 두 표에 나뉘어 있다. 새 조회 API 가 새 표에 없으면 옛 표를
 * 읽어 <b>같은 응답 모양</b>을 내는지, 그리고 그 과정에서 <b>옛 테이블을 건드리지 않는지</b>가 여기서 보는
 * 전부다.
 */
@SpringBootTest(properties = {
    "JWT_SECRET=test-secret",
    "ACCOUNT_CLEANUP_ENABLED=false",
    "ACCOUNT_HOUSEKEEPING_ENABLED=false",
    "ANALYSIS_WORKER_ENABLED=false",
    "EXIT_SURVEY_SYNC_ENABLED=false"
})
@AutoConfigureMockMvc
class PracticeCompatibilityIT {

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        String name = PostgresContainerSupport.createDatabaseName("practice_compat");
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
    PracticeDataMigration migration;

    private UUID member;
    private String bearer;

    @BeforeEach
    void setUp() {
        jdbc.execute("TRUNCATE TABLE users RESTART IDENTITY CASCADE");
        jdbc.execute("TRUNCATE TABLE practice_migration_entries");
        member = member();
        bearer = "Bearer " + jwt.issueAccessToken(member).value();
    }

    @Test
    @DisplayName("practice.library: 아직 옮기지 않은 옛 연습이 새 조회 API 에서 같은 모양으로 온다 — 상세·상태·"
            + "묶음 목록. 구형 관찰은 상태(요약)만 오고 옛 테이블은 그대로다")
    void practiceLibrary_readsUnmigratedSessionsThroughTheNewApi() throws Exception {
        UUID first = session(intent("videos/a.mp4"), null, "analyzed");
        UUID second = session(intent("videos/b.mp4"), first, "analyzed");
        summary(second, "[{\"what\":\"호흡이 얕다\"}]", "[\"조명이 어둡다\"]");

        JsonNode detail = json(get("/v2/practices/{id}", second), 200);

        assertThat(detail.path("id").textValue()).isEqualTo(second.toString());
        assertThat(detail.path("root_id").textValue()).as("체인이 묶음과 차수로 펴진다").isEqualTo(first.toString());
        assertThat(detail.path("ordinal").intValue()).isEqualTo(2);
        assertThat(detail.path("stage").textValue()).isEqualTo("conversing");
        assertThat(detail.path("analysis_status").textValue())
                .as("구형 관찰은 상태만 낸다 — 못 본 구간이 있으면 partial").isEqualTo("partial");
        assertThat(detail.path("situation").textValue()).isEqualTo("문 앞에서 돌아선다");

        assertThat(json(get("/v2/practices/{id}/status", second), 200).path("stage").textValue())
                .isEqualTo("conversing");

        JsonNode groups = json(get("/v2/practices"), 200).path("groups");
        assertThat(groups).hasSize(1);
        assertThat(groups.get(0).path("root_id").textValue()).isEqualTo(first.toString());
        assertThat(groups.get(0).path("practices")).hasSize(2);

        assertThat(jdbc.queryForObject("SELECT count(*) FROM practices", Integer.class))
                .as("읽기는 옛 자료를 옮기지 않는다").isZero();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM practice_sessions", Integer.class)).isEqualTo(2);
    }

    @Test
    @DisplayName("practice.note: 아직 옮기지 않은 옛 노트가 새 조회 경로에서 온다 — 기존 갈래는 format legacy 로 "
            + "종류를 그대로 두고 옛 공개 필드가 원문으로 그대로 실린다")
    void practiceNote_readsUnmigratedReportsThroughTheNewApi() throws Exception {
        UUID practice = session(intent("videos/note.mp4"), null, "analyzed");
        UUID conversation = conversation(practice, "closed", "2026-09-10 00:00:00+00");
        UUID handoff = handoff(practice, conversation);
        jdbc.update("""
                INSERT INTO practice_reports(id,practice_session_id,report_type,report_json,source_handoff_id)
                VALUES (?,?,'expression',?::jsonb,?)
                """, UUID.randomUUID(), practice,
                "{\"title\":\"옛 노트 제목\",\"next_step\":\"호흡을 한 박자 늦춘다\"}", handoff);

        JsonNode note = json(get("/v2/practices/{id}/note", practice), 200);

        assertThat(note.path("format").textValue()).isEqualTo("legacy");
        assertThat(note.path("kind").textValue()).isEqualTo("expression");
        assertThat(note.path("title").textValue()).isEqualTo("옛 노트 제목");
        assertThat(note.path("conversation_id").textValue()).isEqualTo(conversation.toString());
        assertThat(note.path("report").path("next_step").textValue()).isEqualTo("호흡을 한 박자 늦춘다");
        assertThat(note.path("summary_quotes")).isEmpty();
    }

    @Test
    @DisplayName("practice.coach: 옛 자료의 복수 대화 회차 조회 — 가장 최근 하나가 대화이고 나머지는 이전 대화 "
            + "목록으로 온다. 이전 대화도 대화 조회로 열린다")
    void practiceCoach_readsTheOlderConversationsOfOneLegacyPractice() throws Exception {
        UUID practice = session(intent("videos/talk.mp4"), null, "analyzed");
        UUID older = conversation(practice, "closed", "2026-09-01 00:00:00+00");
        UUID latest = conversation(practice, "open", "2026-09-10 00:00:00+00");
        turn(older, 0, "ai", "옛 대화의 첫 말");
        turn(latest, 0, "ai", "무엇이 달라졌나요");

        JsonNode detail = json(get("/v2/practices/{id}", practice), 200);

        assertThat(detail.path("conversation_id").textValue()).isEqualTo(latest.toString());
        assertThat(detail.path("previous_conversations")).hasSize(1);
        assertThat(detail.path("previous_conversations").get(0).path("id").textValue())
                .isEqualTo(older.toString());
        assertThat(detail.path("previous_conversations").get(0).path("status").textValue()).isEqualTo("closed");

        JsonNode opened = json(get("/v2/coach/conversations/{id}", older), 200);
        assertThat(opened.path("practice_id").textValue()).isEqualTo(practice.toString());
        assertThat(opened.path("messages")).hasSize(1);
        assertThat(opened.path("messages").get(0).path("role").textValue()).isEqualTo("coach");
        assertThat(opened.path("messages").get(0).path("text").textValue()).isEqualTo("옛 대화의 첫 말");
    }

    @Test
    @DisplayName("02-practice ②: 옮긴 뒤에도 같은 응답이다 — 옮긴 회차는 새 표에서 오고, 전환이 남겨 둔 옛 대화는 "
            + "이전 대화 목록으로 그대로 보인다")
    void practiceLibrary_answersTheSameShapeBeforeAndAfterTheMigration() throws Exception {
        UUID practice = session(intent("videos/same.mp4"), null, "analyzed");
        UUID older = conversation(practice, "closed", "2026-09-01 00:00:00+00");
        conversation(practice, "closed", "2026-09-10 00:00:00+00");
        summary(practice, "[]", "[]");

        JsonNode before = json(get("/v2/practices/{id}", practice), 200);

        migration.run(50);
        JsonNode after = json(get("/v2/practices/{id}", practice), 200);

        assertThat(jdbc.queryForObject("SELECT count(*) FROM practices", Integer.class)).isEqualTo(1);
        for (String field : java.util.List.of(
                "id", "root_id", "ordinal", "stage", "situation", "goal", "analysis_status",
                "conversation_id", "blockage_category", "blockage_detail", "experience_version")) {
            assertThat(after.path(field)).as("옮기기 전후의 %s 가 같다", field).isEqualTo(before.path(field));
        }
        assertThat(after.path("previous_conversations")).hasSize(1);
        assertThat(after.path("previous_conversations").get(0).path("id").textValue())
                .isEqualTo(older.toString());
    }

    // --- 도우미 -------------------------------------------------------------

    private UUID member() {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO users(id,status) VALUES (?,'active')", id);
        jdbc.update("INSERT INTO user_identities(id,user_id,provider,provider_uid) VALUES (?,?,'google',?)",
                UUID.randomUUID(), id, "g-" + id);
        AccountFixtures.passGate(jdbc, id);
        return id;
    }

    private UUID intent(String objectKey) {
        UUID id = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO upload_intents(id,user_id,status,storage_provider,object_key,mime_type,
                                           size_bytes,duration_ms,expires_at,finalized_at)
                VALUES (?,?,'finalized','s3',?,'video/mp4',1000,12000,now() + interval '1 hour',now())
                """, id, member, objectKey);
        return id;
    }

    private UUID session(UUID intentId, UUID continuedFrom, String status) {
        UUID id = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO practice_sessions(id,user_id,upload_intent_id,status,situation,character_context,
                                              blockage_kind,sub_branch,goal,continued_from)
                VALUES (?,?,?,?,'문 앞에서 돌아선다','연인','표현','감정','망설임을 보여 주기',?)
                """, id, member, intentId, status, continuedFrom);
        return id;
    }

    private void summary(UUID sessionId, String observations, String uncertainties) {
        jdbc.update("""
                INSERT INTO summaries(id,session_id,model,raw,observations_json,uncertainties_json)
                VALUES (?,?,'gpt','null'::jsonb,?::jsonb,?::jsonb)
                """, UUID.randomUUID(), sessionId, observations, uncertainties);
    }

    private UUID conversation(UUID practiceSessionId, String status, String createdAt) {
        UUID id = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO coach_sessions(id,practice_session_id,status,conversation_summary,
                                           created_at,updated_at)
                VALUES (?,?,?,'',?::timestamptz,?::timestamptz)
                """, id, practiceSessionId, status, createdAt, createdAt);
        return id;
    }

    private void turn(UUID coachSessionId, int index, String role, String text) {
        jdbc.update("INSERT INTO coach_turns(session_id,turn_index,role,text) VALUES (?,?,?,?)",
                coachSessionId, index, role, text);
    }

    private UUID handoff(UUID practiceSessionId, UUID coachSessionId) {
        UUID id = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO coaching_handoffs(id,coach_session_id,practice_session_id,branch_kind,
                                              handoff_json,state_revision)
                VALUES (?,?,?,'expression','{}'::jsonb,3)
                """, id, coachSessionId, practiceSessionId);
        return id;
    }

    private JsonNode json(MockHttpServletRequestBuilder request, int status) throws Exception {
        MockHttpServletResponse response = mvc.perform(request
                        .header("Authorization", bearer)
                        .contentType(MediaType.APPLICATION_JSON))
                .andReturn()
                .getResponse();
        assertThat(response.getStatus()).as(response.getContentAsString()).isEqualTo(status);
        return mapper.readTree(response.getContentAsString());
    }
}
