package com.acttub.actingapi.feature.coach;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;

import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;

import com.acttub.actingapi.feature.auth.app.JwtService;
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
 * practice.note 의 노트 평가 — "도움 됐어요·아쉬웠어요" 와 한 줄을 HTTP 와 실제 Postgres 로 본다.
 *
 * <p>노트 하나에 사람 하나가 한 행이고({@code uq_note_ratings_note_user}) 다시 누르면 덮어쓴다. 요청 id 로
 * 멱등하고, 같은 id 에 다른 본문이면 422 {@code request_fingerprint_mismatch} 다. 게이트·소유권은
 * {@code GET /v2/practices/{id}/note} 와 같다 — 없는 것·남의 것·노트가 아직 없는 것은 모두 같은 404
 * {@code note_not_found} 다.
 */
@SpringBootTest(properties = {
    "JWT_SECRET=test-secret",
    "ACCOUNT_CLEANUP_ENABLED=false",
    "ACCOUNT_HOUSEKEEPING_ENABLED=false",
    "ANALYSIS_WORKER_ENABLED=false",
    "EXIT_SURVEY_SYNC_ENABLED=false"
})
@AutoConfigureMockMvc
@Import(NoteRatingIT.Fixture.class)
class NoteRatingIT {

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        String name = PostgresContainerSupport.createDatabaseName("note_rating");
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

    private UUID member;
    private String bearer;
    private UUID practice;
    private UUID note;

    @BeforeEach
    void setUp() {
        jdbc.execute("TRUNCATE TABLE users RESTART IDENTITY CASCADE");
        clock.set(Instant.parse("2026-09-24T00:00:00Z"));
        member = member();
        bearer = bearer(member);
        practice = practice(member);
        note = note(practice);
    }

    @Test
    @DisplayName("practice.note: 누르는 순간 노트 단위로 저장된다 — 한 줄은 앞뒤 공백을 걷어 같은 행에 붙고, 응답은 "
            + "{rating, comment, updated_at} 이다")
    void rating_isStoredPerNote() throws Exception {
        UUID requestId = UUID.randomUUID();
        JsonNode saved = json(rate(requestId, "helpful", "  시선 얘기가 좋았어요  "), 200);

        assertThat(saved.path("rating").textValue()).isEqualTo("helpful");
        assertThat(saved.path("comment").textValue()).isEqualTo("시선 얘기가 좋았어요");
        assertThat(saved.path("updated_at").textValue()).isEqualTo("2026-09-24T00:00:00.000000Z");
        assertThat(saved.properties()).extracting(Map.Entry::getKey)
                .containsExactlyInAnyOrder("rating", "comment", "updated_at");

        Map<String, Object> row = jdbc.queryForMap("SELECT * FROM note_ratings");
        assertThat(row.get("practice_id")).isEqualTo(practice);
        assertThat(row.get("note_id")).isEqualTo(note);
        assertThat(row.get("user_id")).isEqualTo(member);
        assertThat(row.get("rating")).isEqualTo("helpful");
        assertThat(row.get("comment")).isEqualTo("시선 얘기가 좋았어요");
        assertThat(row.get("request_id")).isEqualTo(requestId);
    }

    @Test
    @DisplayName("practice.note: 같은 노트에 다시 누르면 덮어쓴다 — 행은 하나이고, 한 줄 없이 보내면 한 줄이 비워진다")
    void rating_overwritesTheSameRow() throws Exception {
        perform(rate(UUID.randomUUID(), "helpful", "좋았어요"), 200);
        clock.advance(Duration.ofMinutes(3));

        JsonNode changed = json(rate(UUID.randomUUID(), "not_helpful", null), 200);

        assertThat(changed.path("rating").textValue()).isEqualTo("not_helpful");
        assertThat(changed.path("comment").isNull()).isTrue();
        assertThat(changed.path("updated_at").textValue()).isEqualTo("2026-09-24T00:03:00.000000Z");
        assertThat(jdbc.queryForObject("SELECT count(*) FROM note_ratings", Integer.class)).isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT created_at < updated_at FROM note_ratings", Boolean.class)).isTrue();

        // 빈 한 줄은 없는 것과 같다.
        assertThat(json(rate(UUID.randomUUID(), "helpful", "   "), 200).path("comment").isNull()).isTrue();
        assertThat(jdbc.queryForObject("SELECT comment FROM note_ratings", String.class)).isNull();
    }

    @Test
    @DisplayName("practice.note: 같은 request_id·같은 본문의 재전송은 200 같은 응답이고 행을 바꾸지 않는다 — 기기가 "
            + "들고 있다 다시 보내도 된다. 같은 id 에 다른 본문은 422 request_fingerprint_mismatch")
    void rating_isIdempotentPerRequestId() throws Exception {
        UUID requestId = UUID.randomUUID();
        String first = perform(rate(requestId, "helpful", "좋았어요"), 200).getContentAsString();
        clock.advance(Duration.ofMinutes(5));

        String again = perform(rate(requestId, "helpful", " 좋았어요 "), 200).getContentAsString();

        assertThat(mapper.readTree(again)).isEqualTo(mapper.readTree(first));
        assertThat(jdbc.queryForObject("SELECT count(*) FROM note_ratings", Integer.class)).isEqualTo(1);

        for (String[] changed : new String[][] {{"not_helpful", "좋았어요"}, {"helpful", "다른 말"}, {"helpful", null}}) {
            assertThat(mapper.readTree(perform(rate(requestId, changed[0], changed[1]), 422).getContentAsString()))
                    .isEqualTo(mapper.readTree("{\"detail\":\"request_fingerprint_mismatch\"}"));
        }
        assertThat(jdbc.queryForMap("SELECT rating,comment FROM note_ratings"))
                .containsEntry("rating", "helpful")
                .containsEntry("comment", "좋았어요");
    }

    @Test
    @DisplayName("practice.note: 남의 노트·없는 회차·노트가 아직 없는 내 회차는 모두 같은 404 note_not_found 이고 "
            + "아무것도 남지 않는다")
    void rating_hidesOthersAndMissingNotes() throws Exception {
        UUID stranger = member();
        UUID theirPractice = practice(stranger);
        note(theirPractice);
        UUID noteless = practice(member);

        for (UUID target : new UUID[] {theirPractice, UUID.randomUUID(), noteless}) {
            assertThat(mapper.readTree(perform(rate(target, UUID.randomUUID(), "helpful", null), 404)
                            .getContentAsString()))
                    .isEqualTo(mapper.readTree("{\"detail\":\"note_not_found\"}"));
        }
        assertThat(jdbc.queryForObject("SELECT count(*) FROM note_ratings", Integer.class)).isZero();

        // 남이 읽어도 내 평가는 없다 — 노트 조회가 404 다.
        var theirs = mvc.perform(get("/v2/practices/{id}/note", practice).header("Authorization", bearer(stranger)))
                .andReturn().getResponse();
        assertThat(theirs.getStatus()).isEqualTo(404);
    }

    @Test
    @DisplayName("practice.note: 값 목록 밖의 rating 과 모양이 틀린 본문은 422 배열, 한 줄 101자는 422 comment_too_long "
            + "이다. 길이는 코드 포인트로 세서 이모지 100개는 받는다")
    void rating_validatesTheBody() throws Exception {
        assertThat(json(rate(UUID.randomUUID(), "great", null), 422).path("detail").isArray()).isTrue();
        assertThat(json(put("/v2/practices/{id}/note/rating", practice).content("{\"rating\":\"helpful\"}"), 422)
                .path("detail").isArray()).isTrue();
        assertThat(json(put("/v2/practices/{id}/note/rating", practice).content(
                        "{\"request_id\":\"%s\",\"rating\":\"helpful\",\"score\":5}".formatted(UUID.randomUUID())), 422)
                .path("detail").isArray()).isTrue();

        assertThat(mapper.readTree(perform(rate(UUID.randomUUID(), "helpful", "가".repeat(101)), 422)
                        .getContentAsString()))
                .isEqualTo(mapper.readTree("{\"detail\":\"comment_too_long\"}"));
        perform(rate(UUID.randomUUID(), "helpful", "가".repeat(100)), 200);
        perform(rate(UUID.randomUUID(), "not_helpful", "🎭".repeat(100)), 200);
        assertThat(jdbc.queryForObject("SELECT rating FROM note_ratings", String.class)).isEqualTo("not_helpful");
    }

    @Test
    @DisplayName("practice.note: 노트 조회의 my_rating 은 남긴 평가가 없으면 null 이고, 남기면 그 값이다")
    void noteRead_carriesMyRating() throws Exception {
        JsonNode before = json(get("/v2/practices/{id}/note", practice), 200);
        assertThat(before.has("my_rating")).isTrue();
        assertThat(before.path("my_rating").isNull()).isTrue();

        perform(rate(UUID.randomUUID(), "not_helpful", "질문이 길었어요"), 200);

        JsonNode after = json(get("/v2/practices/{id}/note", practice), 200);
        assertThat(after.path("id").textValue()).isEqualTo(note.toString());
        assertThat(after.path("my_rating").path("rating").textValue()).isEqualTo("not_helpful");
        assertThat(after.path("my_rating").path("comment").textValue()).isEqualTo("질문이 길었어요");
        assertThat(after.path("my_rating").path("updated_at").textValue()).isEqualTo("2026-09-24T00:00:00.000000Z");
    }

    @Test
    @DisplayName("account.withdraw: 탈퇴하면 한 줄은 파기되고 평가 값은 사람과 끊어 남는다. 탈퇴한 계정의 평가는 403 이다")
    void withdrawal_erasesTheCommentAndKeepsTheRating() throws Exception {
        perform(rate(UUID.randomUUID(), "helpful", "연락 주세요 010-0000-0000"), 200);

        accounts.withdraw(member);

        assertThat(jdbc.queryForMap("SELECT rating,comment,user_id FROM note_ratings"))
                .containsEntry("rating", "helpful")
                .containsEntry("comment", null)
                .containsEntry("user_id", member);
        perform(rate(UUID.randomUUID(), "not_helpful", "탈퇴 뒤"), 403);
    }

    // --- 도우미 -------------------------------------------------------------

    private MockHttpServletRequestBuilder rate(UUID requestId, String rating, String comment) {
        return rate(practice, requestId, rating, comment);
    }

    private MockHttpServletRequestBuilder rate(UUID practiceId, UUID requestId, String rating, String comment) {
        StringBuilder payload = new StringBuilder("{\"request_id\":\"%s\",\"rating\":\"%s\"".formatted(requestId, rating));
        if (comment != null) {
            payload.append(",\"comment\":\"%s\"".formatted(comment));
        }
        return put("/v2/practices/{id}/note/rating", practiceId).content(payload.append("}").toString());
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
                VALUES (?,?,?,?,1,'closed','three_layers_v1','표현','감정','문 앞에서 돌아선다')
                """, id, owner, videoId, id);
        return id;
    }

    /** 닫힌 대화와 그 노트. */
    private UUID note(UUID practiceId) {
        UUID conversation = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO coach_conversations(id,practice_id,start_request_id,status,close_reason,closed_at)
                VALUES (?,?,?,'closed','user_ended',now())
                """, conversation, practiceId, UUID.randomUUID());
        UUID id = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO coach_notes(id,conversation_id,format,kind,title,next_take,source_revision)
                VALUES (?,?,'v2','action','기다리는 시선','대사가 끝나도 시선을 두고 찍어보세요',3)
                """, id, conversation);
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
        assertThat(response.getStatus()).as(response.getContentAsString()).isEqualTo(status);
        return response;
    }

    @TestConfiguration
    static class Fixture {
        @Bean
        @Primary
        MutableClock mutableClock() {
            return new MutableClock(Instant.parse("2026-09-24T00:00:00Z"));
        }
    }
}
