package com.acttub.actingapi.feature.practice;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import java.util.UUID;

import com.acttub.actingapi.feature.auth.app.JwtService;
import com.acttub.actingapi.support.AccountFixtures;
import com.acttub.actingapi.support.MovedLegacyPractice;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import com.acttub.actingapi.platform.json.LenientJson;

/**
 * specs/practice 「0.1.0 스키마 전환」 — <b>옛 표에 남은 자료를 읽는 경로</b>를 HTTP 로 본다.
 *
 * <p>옛 연습은 모두 새 표로 옮겼다. 옮길 때 대화는 가장 최근 하나만 갔으므로, 그보다 앞선 대화와 그 노트는 옛 표에만
 * 있다. 새 조회 API 가 그것을 <b>같은 응답 모양</b>으로 내는지, 그 과정에서 <b>옛 테이블을 건드리지 않는지</b>, 그리고
 * 새 표에 없는 연습은 더 읽지 않는지가 여기서 보는 전부다.
 */
@SpringBootTest(properties = "JWT_SECRET=test-secret")
@AutoConfigureMockMvc
class PracticeCompatibilityIT {

    @Autowired
    MockMvc mvc;
    @Autowired
    JdbcTemplate jdbc;
    @Autowired
    ObjectMapper mapper;
    @Autowired
    JwtService jwt;
    private UUID member;
    private String bearer;

    @BeforeEach
    void setUp() {
        jdbc.execute("TRUNCATE TABLE users RESTART IDENTITY CASCADE");
        member = member();
        bearer = "Bearer " + jwt.issueAccessToken(member).value();
    }

    @Test
    @DisplayName("practice.library: 새 표에 없는 옛 연습은 읽지 않는다 — 상세·상태·노트는 404 이고 묶음 목록에 없다. "
            + "옛 테이블은 그대로다")
    void practiceLibrary_doesNotReadAPracticeThatIsOnlyInTheOldTables() throws Exception {
        UUID practice = session(intent("videos/a.mp4"), null, "analyzed");
        summary(practice, "[{\"what\":\"호흡이 얕다\"}]", "[]");

        json(get("/v2/practices/{id}", practice), 404);
        json(get("/v2/practices/{id}/status", practice), 404);
        json(get("/v2/practices/{id}/analysis", practice), 404);
        json(get("/v2/practices/{id}/note", practice), 404);
        assertThat(json(get("/v2/practices"), 200).path("groups")).isEmpty();

        assertThat(jdbc.queryForObject("SELECT count(*) FROM practices", Integer.class)).isZero();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM practice_sessions", Integer.class)).isEqualTo(1);
    }

    @Test
    @DisplayName("practice.note: 새 표에 노트가 없는 회차는 옛 표에 남은 노트가 새 조회 경로에서 온다 — 기존 갈래는 "
            + "format legacy 로 종류를 그대로 두고 옛 공개 필드가 원문으로 그대로 실린다")
    void practiceNote_readsTheNoteOfAnOlderConversationLeftInTheOldTables() throws Exception {
        UUID practice = session(intent("videos/note.mp4"), null, "analyzed");
        UUID older = conversation(practice, "closed", "2026-09-01 00:00:00+00");
        conversation(practice, "closed", "2026-09-10 00:00:00+00");
        UUID handoff = handoff(practice, older);
        jdbc.update("""
                INSERT INTO practice_reports(id,practice_session_id,report_type,report_json,source_handoff_id)
                VALUES (?,?,'expression',?::jsonb,?)
                """, UUID.randomUUID(), practice,
                "{\"title\":\"옛 노트 제목\",\"next_step\":\"호흡을 한 박자 늦춘다\"}", handoff);
        MovedLegacyPractice.move(jdbc, practice);
        MovedLegacyPractice.moveLatestConversation(jdbc, practice);

        JsonNode note = json(get("/v2/practices/{id}/note", practice), 200);

        assertThat(note.path("format").stringValue(null)).isEqualTo("legacy");
        assertThat(note.path("kind").stringValue(null)).isEqualTo("expression");
        assertThat(note.path("title").stringValue(null)).isEqualTo("옛 노트 제목");
        assertThat(note.path("conversation_id").stringValue(null)).isEqualTo(older.toString());
        assertThat(note.path("report").path("next_step").stringValue(null)).isEqualTo("호흡을 한 박자 늦춘다");
        assertThat(note.path("summary_quotes")).isEmpty();
    }

    @Test
    @DisplayName("practice.coach: 옛 자료의 복수 대화 회차 조회 — 새 표로 간 가장 최근 하나가 대화이고 옛 표에 남은 나머지는 "
            + "이전 대화 목록으로 온다. 이전 대화도 대화 조회로 열린다")
    void practiceCoach_readsTheOlderConversationsOfOneLegacyPractice() throws Exception {
        UUID practice = session(intent("videos/talk.mp4"), null, "analyzed");
        UUID older = conversation(practice, "closed", "2026-09-01 00:00:00+00");
        UUID latest = conversation(practice, "closed", "2026-09-10 00:00:00+00");
        turn(older, 0, "ai", "옛 대화의 첫 말");
        turn(latest, 0, "ai", "무엇이 달라졌나요");
        MovedLegacyPractice.move(jdbc, practice);
        MovedLegacyPractice.moveLatestConversation(jdbc, practice);

        JsonNode detail = json(get("/v2/practices/{id}", practice), 200);

        assertThat(detail.path("conversation_id").stringValue(null)).isEqualTo(latest.toString());
        assertThat(detail.path("previous_conversations")).hasSize(1);
        assertThat(detail.path("previous_conversations").get(0).path("id").stringValue(null))
                .isEqualTo(older.toString());
        assertThat(detail.path("previous_conversations").get(0).path("status").stringValue(null)).isEqualTo("closed");

        JsonNode opened = json(get("/v2/coach/conversations/{id}", older), 200);
        assertThat(opened.path("practice_id").stringValue(null)).isEqualTo(practice.toString());
        assertThat(opened.path("messages")).hasSize(1);
        assertThat(opened.path("messages").get(0).path("role").stringValue(null)).isEqualTo("coach");
        assertThat(opened.path("messages").get(0).path("text").stringValue(null)).isEqualTo("옛 대화의 첫 말");
    }

    @Test
    @DisplayName("practice.coach: 옛 표에 남은 대화는 열려 있어도 이어 말할 수 없다 — closed 로 보여 화면이 답을 받지 않게 "
            + "한다. 옛 표의 값은 그대로다")
    void practiceCoach_anOpenConversationLeftInTheOldTablesIsShownClosed() throws Exception {
        UUID practice = session(intent("videos/open.mp4"), null, "analyzed");
        UUID open = conversation(practice, "open", "2026-09-01 00:00:00+00");
        conversation(practice, "closed", "2026-09-10 00:00:00+00");
        turn(open, 0, "ai", "무엇이 달라졌나요");
        MovedLegacyPractice.move(jdbc, practice);
        MovedLegacyPractice.moveLatestConversation(jdbc, practice);

        // 새 쓰기 경로는 새 표만 본다 — 옛 표의 열린 대화에 답하면 404 다.
        json(post("/v2/coach/reply").content("{\"conversation_id\":\"" + open + "\",\"request_id\":\"" + UUID.randomUUID()
                + "\",\"text\":\"숨이 막혔어요\"}"), 404);

        JsonNode detail = json(get("/v2/practices/{id}", practice), 200);
        assertThat(detail.path("previous_conversations").get(0).path("id").stringValue(null)).isEqualTo(open.toString());
        assertThat(detail.path("previous_conversations").get(0).path("status").stringValue(null)).isEqualTo("closed");
        assertThat(json(get("/v2/coach/conversations/{id}", open), 200).path("status").stringValue(null)).isEqualTo("closed");
        assertThat(jdbc.queryForObject("SELECT status::text FROM coach_sessions WHERE id=?", String.class, open))
                .as("옛 표는 고치지 않는다").isEqualTo("open");
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
                INSERT INTO coach_sessions(id,practice_session_id,status,created_at,updated_at)
                VALUES (?,?,?,?::timestamptz,?::timestamptz)
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
                INSERT INTO coaching_handoffs(id,coach_session_id,practice_session_id,state_revision)
                VALUES (?,?,?,3)
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
