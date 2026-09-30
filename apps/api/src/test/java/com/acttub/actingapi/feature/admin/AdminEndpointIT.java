package com.acttub.actingapi.feature.admin;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.HexFormat;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import com.acttub.actingapi.integration.storage.ObjectStorage;
import com.acttub.actingapi.integration.storage.StoredObjectMetadata;
import com.acttub.actingapi.support.PostgresContainerSupport;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.hibernate.resource.jdbc.spi.StatementInspector;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest(properties = {
    "JWT_SECRET=test-secret",
    "ADMIN_OPS_TOKEN=admin-secret",
    "ADMIN_OPS_EXCLUDE_EMAILS=team@acttub.com",
    "spring.jpa.properties.hibernate.session_factory.statement_inspector="
            + "com.acttub.actingapi.feature.admin.AdminEndpointIT$RecordingInspector"
})
@AutoConfigureMockMvc
@Import(AdminEndpointIT.StorageFixture.class)
class AdminEndpointIT {
    public static class RecordingInspector implements StatementInspector {
        private static final ThreadLocal<List<String>> STATEMENTS =
                ThreadLocal.withInitial(ArrayList::new);

        @Override
        public String inspect(String sql) {
            STATEMENTS.get().add(sql);
            return sql;
        }
    }

    private static final UUID REAL_USER =
            UUID.fromString("00000000-0000-4000-8000-000000000601");
    private static final UUID TEAM_USER =
            UUID.fromString("00000000-0000-4000-8000-000000000602");
    private static final OffsetDateTime NOW =
            OffsetDateTime.now(ZoneOffset.UTC).withNano(123456000);

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        String name = PostgresContainerSupport.createDatabaseName("admin_endpoint");
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

    private UUID realFinalCoach;
    private UUID realPendingCoach;

    @AfterEach
    void clearStatements() {
        RecordingInspector.STATEMENTS.remove();
    }

    @BeforeEach
    void setUp() {
        jdbc.execute("TRUNCATE TABLE users, consent_documents RESTART IDENTITY CASCADE");
        insertUser(REAL_USER, "actor@example.com", NOW.minusHours(2));
        insertUser(TEAM_USER, "Team@Acttub.com", NOW.minusHours(1));

        UUID realFinal = insertPractice(
                REAL_USER, "real.mp4", "finalized", NOW.minusMinutes(30));
        UUID realPending = insertPractice(
                REAL_USER, "pending.mp4", "pending", NOW.minusMinutes(20));
        UUID team = insertPractice(
                TEAM_USER, "team.mp4", "finalized", NOW.minusMinutes(10));
        realFinalCoach = insertCoach(realFinal, NOW.minusMinutes(30));
        realPendingCoach = insertCoach(realPending, NOW.minusMinutes(20));
        UUID teamCoach = insertCoach(team, NOW.minusMinutes(10));
        jdbc.update("""
                UPDATE coach_sessions
                SET status='closed',
                    close_reason='gap_stated'
                WHERE id=?
                """, realFinalCoach);
        insertTurn(realFinalCoach, 0, "actor", "첫 질문");
        insertTurn(realPendingCoach, 0, "ai", "두 번째 답변");
        insertTurn(teamCoach, 0, "actor", "팀 대화");
    }

    /** 토큰이 없거나 틀리면 401 이다. 관리자 경로 전체가 이 검사 뒤에 있다. */
    @Test
    void requestsWithoutAValidTokenAreRejected() throws Exception {
        assertUnauthorized(null);
        assertUnauthorized("Bearer nope");
    }

    @Test
    void sessionsResponseIsIdenticalWhileConditionalLeftJoinsAndPresignFallbackApply()
            throws Exception {
        JsonNode sessions = authorized("/v2/admin/sessions", 200);
        assertThat(sessions.path("playback_expires_in_sec").intValue()).isEqualTo(3600);
        assertThat(sessions.path("sessions")).hasSize(2);

        JsonNode pending = sessions.path("sessions").get(0);
        assertThat(pending.fieldNames()).toIterable().containsExactly(
                "coach_session_id",
                "created_at",
                "status",
                "close_reason",
                "situation",
                "character_context",
                "goal",
                "turns",
                "video_url");
        assertThat(pending.path("coach_session_id").textValue())
                .isEqualTo(realPendingCoach.toString());
        assertThat(pending.path("status").textValue()).isEqualTo("open");
        assertThat(pending.path("close_reason").isNull()).isTrue();
        assertThat(pending.path("turns").get(0).path("role").textValue())
                .isEqualTo("ai");
        assertThat(pending.path("video_url").isNull()).isTrue();

        JsonNode finalized = sessions.path("sessions").get(1);
        assertThat(finalized.path("coach_session_id").textValue())
                .isEqualTo(realFinalCoach.toString());
        assertThat(finalized.path("video_url").textValue())
                .isEqualTo("admin:real.mp4:3600");
        assertThat(sessions.toString()).doesNotContain("Team@Acttub.com", TEAM_USER.toString());
    }

    @Test
    void maximumSessionListKeepsOrderedTurnsAndEmptySessionsWithinTwoQueries() throws Exception {
        List<String> expectedIds = new ArrayList<>();
        for (int index = 0; index < 50; index++) {
            OffsetDateTime createdAt = NOW.plusMinutes(index);
            UUID practice = insertPractice(REAL_USER, "batch-" + index + ".mp4", "pending", createdAt);
            UUID coach = insertCoach(practice, createdAt);
            expectedIds.addFirst(coach.toString());
            if (index % 2 == 0) {
                insertTurn(coach, 2, "ai", "답변 " + index);
                insertTurn(coach, 0, "actor", "질문 " + index);
            }
        }

        RecordingInspector.STATEMENTS.get().clear();
        JsonNode response = authorized("/v2/admin/sessions?limit=50", 200);
        assertThat(response.path("sessions")).hasSize(50);
        List<String> actualIds = new ArrayList<>();
        for (int position = 0; position < 50; position++) {
            JsonNode session = response.path("sessions").get(position);
            actualIds.add(session.path("coach_session_id").textValue());
            int index = 49 - position;
            JsonNode expectedTurns = index % 2 == 0
                    ? mapper.readTree("""
                            [{"turn_index":0,"role":"actor","text":"질문 %d"},
                             {"turn_index":2,"role":"ai","text":"답변 %d"}]
                            """.formatted(index, index))
                    : mapper.readTree("[]");
            assertThat(session.path("turns")).isEqualTo(expectedTurns);
        }
        assertThat(actualIds).containsExactlyElementsOf(expectedIds);
        assertThat(RecordingInspector.STATEMENTS.get()).hasSizeLessThanOrEqualTo(2);

        RecordingInspector.STATEMENTS.get().clear();
        JsonNode limited = authorized("/v2/admin/sessions?limit=1", 200);
        assertThat(limited.path("sessions")).hasSize(1);
        assertThat(limited.path("sessions").get(0)).isEqualTo(response.path("sessions").get(0));
        assertThat(RecordingInspector.STATEMENTS.get()).hasSizeLessThanOrEqualTo(2);
    }

    @Test
    void noVisibleSessionsReturnsAnEmptyListWithoutATurnQuery() throws Exception {
        jdbc.update("DELETE FROM coach_sessions WHERE id IN (?, ?)", realFinalCoach, realPendingCoach);

        RecordingInspector.STATEMENTS.get().clear();
        assertThat(authorized("/v2/admin/sessions", 200)).isEqualTo(mapper.readTree("""
                {"sessions":[],"playback_expires_in_sec":3600}
                """));
        assertThat(RecordingInspector.STATEMENTS.get()).hasSize(1);
    }

    @Test
    void limitIsValidatedBeforeTheStoreBoundaryWithPydanticErrorShape() throws Exception {
        JsonNode below = authorized("/v2/admin/sessions?limit=0", 422);
        assertThat(below).isEqualTo(mapper.readTree("""
                {"detail":[{"type":"greater_than_equal","loc":["query","limit"],
                "msg":"Input should be greater than or equal to 1","input":"0","ctx":{"ge":1}}]}
                """));
        JsonNode above = authorized("/v2/admin/sessions?limit=51", 422);
        assertThat(above.at("/detail/0/type").textValue()).isEqualTo("less_than_equal");
        JsonNode invalid = authorized("/v2/admin/sessions?limit=nope", 422);
        assertThat(invalid.at("/detail/0/type").textValue()).isEqualTo("int_parsing");
        assertThat(invalid.at("/detail/0/loc/0").textValue()).isEqualTo("query");

        JsonNode unauthorized = json(mvc.perform(get("/v2/admin/sessions?limit=nope")), 401);
        assertThat(unauthorized).isEqualTo(
                mapper.readTree("{\"detail\":\"Unauthorized\"}"));
    }

    @Test
    void feedbackRequiresAdminTokenBeforeValidationOrDatabaseAccess() throws Exception {
        RecordingInspector.STATEMENTS.get().clear();
        JsonNode response = json(mvc.perform(get("/v2/admin/feedback?limit=nope&include_team=nope")), 401);
        assertThat(response).isEqualTo(mapper.readTree("{\"detail\":\"Unauthorized\"}"));
        assertThat(RecordingInspector.STATEMENTS.get()).isEmpty();
    }

    @Test
    void feedbackCombinesSurveysAndRatingsWithoutPersonalIdentifiersAndFiltersTeamByDefault()
            throws Exception {
        UUID realVideo = insertVideo(REAL_USER, "feedback-real.mp4", NOW.plusMinutes(1));
        UUID realPractice = UUID.randomUUID();
        insertPractice1(realPractice, REAL_USER, realVideo, "closed", "conversation_closed",
                "three_layers_v1", NOW.plusMinutes(1));
        UUID conversation = UUID.randomUUID();
        insertConversation(conversation, realPractice, "closed", "gap_stated", NOW.plusMinutes(1));
        UUID note = UUID.randomUUID();
        jdbc.update("INSERT INTO coach_notes (id,conversation_id,format,kind,source_revision) VALUES (?,?,'v2','action',0)",
                note, conversation);

        UUID answered = UUID.fromString("00000000-0000-4000-8000-000000000711");
        UUID dismissed = UUID.fromString("00000000-0000-4000-8000-000000000712");
        UUID rating = UUID.fromString("00000000-0000-4000-8000-000000000713");
        jdbc.update("""
                INSERT INTO practice_feedback (
                    id,user_id,practice_id,screen,trigger,body,contact_email,contact_phone,created_at,updated_at
                ) VALUES (?, ?, ?, 'report', 'leave', '떠난 이유', 'private@example.com', '010-0000-0000', ?, ?)
                """, answered, REAL_USER, realPractice, NOW.plusMinutes(3), NOW.plusMinutes(3));
        jdbc.update("""
                INSERT INTO practice_feedback (
                    id,user_id,practice_id,screen,trigger,body,created_at,updated_at
                ) VALUES (?, ?, ?, 'coach', 'back', NULL, ?, ?)
                """, dismissed, REAL_USER, realPractice, NOW.plusMinutes(3), NOW.plusMinutes(3));
        jdbc.update("""
                INSERT INTO note_ratings (
                    id,practice_id,note_id,user_id,rating,comment,request_id,created_at,updated_at
                ) VALUES (?, ?, ?, ?, 'not_helpful', '노트 평가 코멘트', ?, ?, ?)
                """, rating, realPractice, note, REAL_USER, UUID.randomUUID(),
                NOW.plusMinutes(4), NOW.plusMinutes(4));

        UUID teamVideo = insertVideo(TEAM_USER, "feedback-team.mp4", NOW.plusMinutes(5));
        UUID teamPractice = UUID.randomUUID();
        insertPractice1(teamPractice, TEAM_USER, teamVideo, "closed", "conversation_closed",
                "three_layers_v1", NOW.plusMinutes(5));
        UUID teamFeedback = UUID.fromString("00000000-0000-4000-8000-000000000714");
        jdbc.update("""
                INSERT INTO practice_feedback (
                    id,user_id,practice_id,screen,trigger,body,contact_email,created_at,updated_at
                ) VALUES (?, ?, ?, 'coach', 'x', '팀 테스트 본문', 'team-private@example.com', ?, ?)
                """, teamFeedback, TEAM_USER, teamPractice, NOW.plusMinutes(5), NOW.plusMinutes(5));

        JsonNode page = authorized("/v2/admin/feedback", 200);
        assertThat(page.path("limit").intValue()).isEqualTo(50);
        assertThat(page.path("has_more").booleanValue()).isFalse();
        assertThat(page.path("items")).hasSize(3);

        JsonNode ratingItem = page.path("items").get(0);
        assertThat(ratingItem.fieldNames()).toIterable().containsExactly(
                "id", "kind", "created_at", "actor", "is_team", "body", "rating", "status",
                "source", "trigger", "practice_id");
        assertThat(ratingItem.path("id").textValue()).isEqualTo(rating.toString());
        assertThat(ratingItem.path("kind").textValue()).isEqualTo("note_rating");
        assertThat(ratingItem.path("actor").textValue())
                .isEqualTo("배우 " + md5(REAL_USER.toString()).substring(0, 8));
        assertThat(ratingItem.path("is_team").booleanValue()).isFalse();
        assertThat(ratingItem.path("body").textValue()).isEqualTo("노트 평가 코멘트");
        assertThat(ratingItem.path("rating").textValue()).isEqualTo("not_helpful");
        assertThat(ratingItem.path("status").isNull()).isTrue();
        assertThat(ratingItem.path("source").textValue()).isEqualTo("practice_note");
        assertThat(ratingItem.path("trigger").isNull()).isTrue();
        assertThat(ratingItem.path("practice_id").textValue()).isEqualTo(realPractice.toString());

        // 같은 created_at 의 설문 둘은 id 오름차순으로 고정된다.
        JsonNode answeredItem = page.path("items").get(1);
        assertThat(answeredItem.path("id").textValue()).isEqualTo(answered.toString());
        assertThat(answeredItem.path("status").textValue()).isEqualTo("answered");
        assertThat(answeredItem.path("source").textValue()).isEqualTo("report");
        assertThat(answeredItem.path("trigger").textValue()).isEqualTo("leave");

        JsonNode dismissedItem = page.path("items").get(2);
        assertThat(dismissedItem.path("kind").textValue()).isEqualTo("exit_survey");
        assertThat(dismissedItem.path("body").isNull()).isTrue();
        assertThat(dismissedItem.path("status").textValue()).isEqualTo("dismissed");
        assertThat(dismissedItem.path("source").textValue()).isEqualTo("coach");
        assertThat(dismissedItem.path("trigger").textValue()).isEqualTo("back");

        assertThat(page.toString()).doesNotContain(
                REAL_USER.toString(), TEAM_USER.toString(), "actor@example.com", "Team@Acttub.com",
                "private@example.com", "010-0000-0000", "team-private@example.com", "팀 테스트 본문");

        JsonNode limited = authorized("/v2/admin/feedback?limit=2", 200);
        assertThat(limited.path("items")).hasSize(2);
        assertThat(limited.path("has_more").booleanValue()).isTrue();
        assertThat(limited.path("items").get(0).path("id").textValue()).isEqualTo(rating.toString());

        JsonNode withTeam = authorized("/v2/admin/feedback?include_team=true", 200);
        assertThat(withTeam.path("items")).hasSize(4);
        assertThat(withTeam.path("items").get(0).path("id").textValue()).isEqualTo(teamFeedback.toString());
        assertThat(withTeam.path("items").get(0).path("is_team").booleanValue()).isTrue();
        assertThat(withTeam.toString()).doesNotContain(
                REAL_USER.toString(), TEAM_USER.toString(), "actor@example.com", "Team@Acttub.com",
                "private@example.com", "010-0000-0000", "team-private@example.com");

        String realActor = md5(REAL_USER.toString()).substring(0, 8);
        JsonNode excludedActor = authorized("/v2/admin/feedback?exclude_actors=" + realActor, 200);
        assertThat(excludedActor.path("items")).hasSize(0);
        JsonNode inspectExcluded = authorized(
                "/v2/admin/feedback?exclude_actors=" + realActor.toUpperCase() + "&include_team=true", 200);
        assertThat(inspectExcluded.path("items")).hasSize(4);
        for (JsonNode item : inspectExcluded.path("items")) {
            assertThat(item.path("is_team").booleanValue()).isTrue();
        }
    }

    @Test
    void feedbackQueryParametersUseBoundedValidation() throws Exception {
        assertThat(authorized("/v2/admin/feedback?limit=0", 422).at("/detail/0/type").textValue())
                .isEqualTo("greater_than_equal");
        JsonNode above = authorized("/v2/admin/feedback?limit=101", 422);
        assertThat(above.at("/detail/0/type").textValue()).isEqualTo("less_than_equal");
        assertThat(above.at("/detail/0/ctx/le").intValue()).isEqualTo(100);
        assertThat(authorized("/v2/admin/feedback?limit=nope", 422).at("/detail/0/type").textValue())
                .isEqualTo("int_parsing");
        JsonNode bool = authorized("/v2/admin/feedback?include_team=maybe", 422);
        assertThat(bool.at("/detail/0/type").textValue()).isEqualTo("bool_parsing");
        assertThat(bool.at("/detail/0/loc/1").textValue()).isEqualTo("include_team");
        JsonNode actor = authorized("/v2/admin/feedback?exclude_actors=nothex12", 422);
        assertThat(actor.at("/detail/0/loc/1").textValue()).isEqualTo("exclude_actors");
    }

    @Test
    void challengeVideoRoutesRequireAdminTokenBeforeQueryValidationOrDatabaseAccess() throws Exception {
        RecordingInspector.STATEMENTS.get().clear();
        assertThat(json(mvc.perform(get("/v2/admin/challenge-videos?limit=nope&visibility=nope")), 401))
                .isEqualTo(mapper.readTree("{\"detail\":\"Unauthorized\"}"));
        assertThat(json(mvc.perform(get("/v2/admin/challenge-videos/{id}/playback", UUID.randomUUID())
                .param("exclude_actors", "nothex12")), 401))
                .isEqualTo(mapper.readTree("{\"detail\":\"Unauthorized\"}"));
        assertThat(RecordingInspector.STATEMENTS.get()).isEmpty();
    }

    @Test
    void challengeVideosFilterVisibilityTeamAndDeletedRowsWithoutLeakingPrivateData() throws Exception {
        UUID memberChallenge = insertChallenge("member", null);
        UUID teamChallenge = insertChallenge("team", null);
        UUID deletedChallenge = insertChallenge("member", NOW.minusMinutes(1));

        UUID publicEntry = insertChallengeEntry(memberChallenge, REAL_USER, "public-secret.mp4",
                "공개 캡션 비밀", "public", "visible", NOW.plusMinutes(5), null);
        UUID privateEntry = insertChallengeEntry(teamChallenge, REAL_USER, "private-secret.mp4",
                "비공개 캡션 비밀", "private", "hidden_by_report", NOW.plusMinutes(4), null);
        UUID purgedEntry = insertChallengeEntry(memberChallenge, REAL_USER, "purged-secret.mp4",
                "파기 캡션 비밀", "private", "visible", NOW.plusMinutes(3), null);
        jdbc.update("UPDATE videos SET purged_at=? WHERE id=(SELECT video_id FROM challenge_entries WHERE id=?)",
                NOW, purgedEntry);
        UUID teamEntry = insertChallengeEntry(memberChallenge, TEAM_USER, "team-secret.mp4",
                "팀 캡션 비밀", "public", "visible", NOW.plusMinutes(6), null);
        UUID deletedEntry = insertChallengeEntry(memberChallenge, REAL_USER, null, null,
                "private", "deleted", NOW.plusMinutes(2), NOW.plusMinutes(2));
        UUID deletedChallengeEntry = insertChallengeEntry(deletedChallenge, REAL_USER, "deleted-challenge.mp4",
                "삭제 챌린지 캡션", "private", "visible", NOW.plusMinutes(1), null);

        var result = mvc.perform(get("/v2/admin/challenge-videos")
                .header("Authorization", "Bearer admin-secret")).andReturn().getResponse();
        assertThat(result.getStatus()).isEqualTo(200);
        assertThat(result.getHeader("Cache-Control")).isEqualTo("private, no-store");
        JsonNode all = mapper.readTree(result.getContentAsString());
        assertThat(all.path("count").intValue()).isEqualTo(3);
        assertThat(all.path("entries")).hasSize(3);

        JsonNode first = all.path("entries").get(0);
        assertThat(first.fieldNames()).toIterable().containsExactly(
                "id", "actor", "created_at", "visibility", "status",
                "challenge_kind", "challenge_ref", "has_video");
        assertThat(first.path("id").textValue()).isEqualTo(publicEntry.toString());
        assertThat(first.path("actor").textValue()).isEqualTo(md5(REAL_USER.toString()).substring(0, 8));
        assertThat(first.path("challenge_kind").textValue()).isEqualTo("member");
        assertThat(first.path("challenge_ref").textValue())
                .isEqualTo(md5(memberChallenge.toString()).substring(0, 8));
        assertThat(first.path("has_video").booleanValue()).isTrue();

        JsonNode second = all.path("entries").get(1);
        assertThat(second.path("id").textValue()).isEqualTo(privateEntry.toString());
        assertThat(second.path("visibility").textValue()).isEqualTo("private");
        assertThat(second.path("status").textValue()).isEqualTo("hidden_by_report");
        assertThat(second.path("challenge_kind").textValue()).isEqualTo("team");
        assertThat(all.path("entries").get(2).path("id").textValue()).isEqualTo(purgedEntry.toString());
        assertThat(all.path("entries").get(2).path("has_video").booleanValue()).isFalse();

        assertThat(all.toString()).doesNotContain(
                teamEntry.toString(), deletedEntry.toString(), deletedChallengeEntry.toString(),
                memberChallenge.toString(), teamChallenge.toString(), deletedChallenge.toString(),
                REAL_USER.toString(), TEAM_USER.toString(), "actor@example.com", "Team@Acttub.com",
                "공개 캡션 비밀", "비공개 캡션 비밀", "파기 캡션 비밀", "팀 캡션 비밀",
                "public-secret.mp4", "private-secret.mp4", "purged-secret.mp4", "admin:", "http");

        JsonNode publicOnly = authorized("/v2/admin/challenge-videos?visibility=public", 200);
        assertThat(publicOnly.path("entries")).hasSize(1);
        assertThat(publicOnly.at("/entries/0/id").textValue()).isEqualTo(publicEntry.toString());
        JsonNode privateOnly = authorized("/v2/admin/challenge-videos?visibility=private", 200);
        assertThat(privateOnly.path("entries")).hasSize(2);
        JsonNode limited = authorized("/v2/admin/challenge-videos?limit=1", 200);
        assertThat(limited.path("entries")).hasSize(1);
        assertThat(limited.path("count").intValue()).isEqualTo(1);

        String actor = md5(REAL_USER.toString()).substring(0, 8);
        assertThat(authorized("/v2/admin/challenge-videos?exclude_actors=" + actor.toUpperCase(), 200)
                .path("entries")).hasSize(0);
    }

    @Test
    void challengeVideoFiltersUseBoundedValidation() throws Exception {
        assertThat(authorized("/v2/admin/challenge-videos?limit=0", 422).at("/detail/0/type").textValue())
                .isEqualTo("greater_than_equal");
        assertThat(authorized("/v2/admin/challenge-videos?limit=101", 422).at("/detail/0/type").textValue())
                .isEqualTo("less_than_equal");
        assertThat(authorized("/v2/admin/challenge-videos?limit=nope", 422).at("/detail/0/type").textValue())
                .isEqualTo("int_parsing");
        JsonNode visibility = authorized("/v2/admin/challenge-videos?visibility=friends", 422);
        assertThat(visibility.at("/detail/0/type").textValue()).isEqualTo("literal_error");
        assertThat(visibility.at("/detail/0/loc/1").textValue()).isEqualTo("visibility");
        JsonNode actor = authorized("/v2/admin/challenge-videos?exclude_actors=nothex12", 422);
        assertThat(actor.at("/detail/0/loc/1").textValue()).isEqualTo("exclude_actors");
    }

    @Test
    void challengePlaybackUsesMockStorageForSixHundredSecondsAndHidesForbiddenEntries() throws Exception {
        UUID challenge = insertChallenge("member", null);
        UUID deletedChallenge = insertChallenge("member", NOW.minusMinutes(1));
        UUID playable = insertChallengeEntry(challenge, REAL_USER, "playable.mp4", "비밀 캡션",
                "private", "visible", NOW.plusMinutes(5), null);
        UUID signingFailure = insertChallengeEntry(challenge, REAL_USER, "signing.fail", "서명 실패 캡션",
                "private", "visible", NOW.plusMinutes(4), null);
        UUID team = insertChallengeEntry(challenge, TEAM_USER, "team-playback.mp4", "팀 캡션",
                "private", "visible", NOW.plusMinutes(3), null);
        UUID deleted = insertChallengeEntry(challenge, REAL_USER, null, null,
                "private", "deleted", NOW.plusMinutes(2), NOW.plusMinutes(2));
        UUID purged = insertChallengeEntry(challenge, REAL_USER, "purged-playback.mp4", "파기 캡션",
                "private", "visible", NOW.plusMinutes(1), null);
        jdbc.update("UPDATE videos SET purged_at=? WHERE id=(SELECT video_id FROM challenge_entries WHERE id=?)",
                NOW, purged);
        UUID challengeDeleted = insertChallengeEntry(deletedChallenge, REAL_USER, "challenge-deleted.mp4", "삭제 캡션",
                "private", "visible", NOW, null);

        var response = mvc.perform(get("/v2/admin/challenge-videos/{id}/playback", playable)
                .header("Authorization", "Bearer admin-secret")).andReturn().getResponse();
        assertThat(response.getStatus()).isEqualTo(200);
        assertThat(response.getHeader("Cache-Control")).isEqualTo("private, no-store");
        assertThat(mapper.readTree(response.getContentAsString())).isEqualTo(mapper.readTree("""
                {"playback_url":"admin:playable.mp4:600","expires_in":600}
                """));

        for (UUID hidden : List.of(UUID.randomUUID(), team, deleted, purged, challengeDeleted)) {
            assertThat(authorized("/v2/admin/challenge-videos/" + hidden + "/playback", 404))
                    .isEqualTo(mapper.readTree("{\"detail\":\"challenge_video_not_found\"}"));
        }
        String actor = md5(REAL_USER.toString()).substring(0, 8);
        assertThat(authorized("/v2/admin/challenge-videos/" + playable + "/playback?exclude_actors=" + actor, 404))
                .isEqualTo(mapper.readTree("{\"detail\":\"challenge_video_not_found\"}"));
        assertThat(authorized("/v2/admin/challenge-videos/" + signingFailure + "/playback", 503))
                .isEqualTo(mapper.readTree("{\"detail\":\"playback_unavailable\"}"));
    }

    @Test
    void readingRoutesRequireAdminTokenBeforeQueryValidationOrDatabaseAccess() throws Exception {
        RecordingInspector.STATEMENTS.get().clear();
        var unauthorized = mvc.perform(get("/v2/admin/reading-sessions?limit=nope&status=nope"))
                .andReturn().getResponse();
        assertThat(unauthorized.getStatus()).isEqualTo(401);
        assertThat(unauthorized.getHeader("Cache-Control")).isEqualTo("private, no-store");
        assertThat(mapper.readTree(unauthorized.getContentAsString()))
                .isEqualTo(mapper.readTree("{\"detail\":\"Unauthorized\"}"));
        assertThat(json(mvc.perform(get("/v2/admin/reading-sessions/{id}", UUID.randomUUID())
                .param("exclude_actors", "nothex12")), 401))
                .isEqualTo(mapper.readTree("{\"detail\":\"Unauthorized\"}"));
        assertThat(json(mvc.perform(get("/v2/admin/reading-recordings/{id}/playback", UUID.randomUUID())
                .param("exclude_actors", "nothex12")), 401))
                .isEqualTo(mapper.readTree("{\"detail\":\"Unauthorized\"}"));
        assertThat(RecordingInspector.STATEMENTS.get()).isEmpty();
    }

    @Test
    void readingSessionsListUsesStableOrderingFiltersAndNoSensitiveFields() throws Exception {
        UUID deactivated = UUID.fromString("00000000-0000-4000-8000-000000000603");
        UUID purged = UUID.fromString("00000000-0000-4000-8000-000000000604");
        insertUser(deactivated, "closed@example.com", NOW.minusHours(3));
        insertUser(purged, "purged@example.com", NOW.minusHours(3));

        ReadingFixture older = insertReading(
                REAL_USER,
                UUID.fromString("00000000-0000-4000-8000-000000000801"),
                "오래된 대본 비밀",
                NOW.plusMinutes(10),
                "in_progress",
                "read");
        ReadingFixture tiedLow = insertReading(
                REAL_USER,
                UUID.fromString("00000000-0000-4000-8000-000000000802"),
                "동시 대본 하나",
                NOW.plusMinutes(20),
                "completed",
                "quiz");
        ReadingFixture tiedHigh = insertReading(
                REAL_USER,
                UUID.fromString("00000000-0000-4000-8000-000000000803"),
                "동시 대본 둘",
                NOW.plusMinutes(20),
                "stopped",
                "read");
        UUID validRecording = insertReadingRecording(
                REAL_USER, tiedHigh.sessionId(), tiedHigh.lines().get(1), "reading/visible.m4a",
                "stt", "관리자 상세에서만 보는 전사", true, NOW.plusMinutes(21));
        ReadingFixture foreign = insertReading(
                REAL_USER,
                UUID.fromString("00000000-0000-4000-8000-000000000804"),
                "다른 대본",
                NOW.plusMinutes(1),
                "completed",
                "read");
        insertReadingRecording(
                REAL_USER, tiedHigh.sessionId(), foreign.lines().get(1), "reading/cross.m4a",
                "none", null, null, NOW.plusMinutes(22));

        insertReading(TEAM_USER, UUID.randomUUID(), "팀 대본", NOW.plusMinutes(30), "completed", "read");
        insertReading(deactivated, UUID.randomUUID(), "탈퇴 대본", NOW.plusMinutes(40), "completed", "read");
        jdbc.update("UPDATE users SET deactivated_at=? WHERE id=?", NOW, deactivated);
        insertReading(purged, UUID.randomUUID(), "파기 대본", NOW.plusMinutes(50), "completed", "read");
        jdbc.update("UPDATE users SET retention_purged_at=? WHERE id=?", NOW, purged);

        ReadingFixture invalidParent = insertReading(
                REAL_USER, UUID.randomUUID(), "부모 불일치 대본", NOW.plusMinutes(60), "completed", "read");
        jdbc.update("UPDATE reading_sessions SET start_line_id=? WHERE id=?",
                foreign.lines().get(0), invalidParent.sessionId());

        var response = mvc.perform(get("/v2/admin/reading-sessions")
                .header("Authorization", "Bearer admin-secret")).andReturn().getResponse();
        assertThat(response.getStatus()).isEqualTo(200);
        assertThat(response.getHeader("Cache-Control")).isEqualTo("private, no-store");
        JsonNode page = mapper.readTree(response.getContentAsString());
        assertThat(page.path("count").intValue()).isEqualTo(4);
        assertThat(page.path("sessions")).hasSize(4);
        assertThat(page.path("sessions").get(0).path("id").textValue())
                .isEqualTo(tiedHigh.sessionId().toString());
        assertThat(page.path("sessions").get(1).path("id").textValue())
                .isEqualTo(tiedLow.sessionId().toString());
        assertThat(page.path("sessions").get(2).path("id").textValue())
                .isEqualTo(older.sessionId().toString());

        JsonNode first = page.path("sessions").get(0);
        assertThat(first.fieldNames()).toIterable().containsExactly(
                "id", "actor", "script_title", "started_at", "ended_at", "status", "mode",
                "elapsed_seconds", "recording_count");
        assertThat(first.path("actor").textValue()).isEqualTo(md5(REAL_USER.toString()).substring(0, 8));
        assertThat(first.path("status").textValue()).isEqualTo("stopped");
        assertThat(first.path("mode").textValue()).isEqualTo("read");
        assertThat(first.path("recording_count").intValue()).isEqualTo(1);
        assertThat(first.path("ended_at").isNull()).isFalse();
        assertThat(page.toString()).doesNotContain(
                REAL_USER.toString(), TEAM_USER.toString(), deactivated.toString(), purged.toString(),
                "actor@example.com", "Team@Acttub.com", "관리자 상세에서만 보는 전사",
                "reading/visible.m4a", "reading/cross.m4a", validRecording.toString());

        JsonNode completed = authorized("/v2/admin/reading-sessions?status=completed", 200);
        assertThat(completed.path("sessions")).hasSize(2);
        for (JsonNode session : completed.path("sessions")) {
            assertThat(session.path("status").textValue()).isEqualTo("completed");
        }
        JsonNode limited = authorized("/v2/admin/reading-sessions?limit=1", 200);
        assertThat(limited.path("sessions")).hasSize(1);
        assertThat(limited.path("count").intValue()).isEqualTo(1);
        String actor = md5(REAL_USER.toString()).substring(0, 8);
        assertThat(authorized("/v2/admin/reading-sessions?exclude_actors=" + actor.toUpperCase(), 200)
                .path("sessions")).hasSize(0);
    }

    @Test
    void readingSessionDetailReturnsWholeScriptAndOnlyValidSessionRecordings() throws Exception {
        ReadingFixture fixture = insertReading(
                REAL_USER, UUID.randomUUID(), "상세 대본", NOW.plusMinutes(10), "completed", "quiz");
        UUID playable = insertReadingRecording(
                REAL_USER, fixture.sessionId(), fixture.lines().get(1), "reading/detail.m4a",
                "stt", "전사 원문", false, NOW.plusMinutes(11));
        ReadingFixture foreign = insertReading(
                REAL_USER, UUID.randomUUID(), "외부 대본", NOW, "completed", "read");
        UUID crossJoined = insertReadingRecording(
                REAL_USER, fixture.sessionId(), foreign.lines().get(1), "reading/cross-detail.m4a",
                "none", null, null, NOW.plusMinutes(12));
        UUID ttsLike = insertReadingRecording(
                REAL_USER, fixture.sessionId(), fixture.lines().get(3), "reading/tts-should-not-exist.m4a",
                "none", null, null, NOW.plusMinutes(13));

        var response = mvc.perform(get("/v2/admin/reading-sessions/{id}", fixture.sessionId())
                .header("Authorization", "Bearer admin-secret")).andReturn().getResponse();
        assertThat(response.getStatus()).isEqualTo(200);
        assertThat(response.getHeader("Cache-Control")).isEqualTo("private, no-store");
        JsonNode detail = mapper.readTree(response.getContentAsString());
        assertThat(detail.fieldNames()).toIterable().containsExactly("session", "lines", "recordings");
        assertThat(detail.path("session").path("recording_count").intValue()).isEqualTo(1);
        assertThat(detail.path("lines")).hasSize(5);
        assertThat(detail.path("recordings")).hasSize(1);

        assertThat(detail.path("lines").get(0)).isEqualTo(mapper.readTree("""
                {"id":"%s","ordinal":1,"kind":"scene","character_name":null,
                 "text":"1막","in_range":false,"is_mine":false}
                """.formatted(fixture.lines().get(0))));
        assertThat(detail.path("lines").get(1).path("kind").textValue()).isEqualTo("dialogue");
        assertThat(detail.path("lines").get(1).path("character_name").textValue()).isEqualTo("나");
        assertThat(detail.path("lines").get(1).path("in_range").booleanValue()).isTrue();
        assertThat(detail.path("lines").get(1).path("is_mine").booleanValue()).isTrue();
        assertThat(detail.path("lines").get(2).path("kind").textValue()).isEqualTo("direction");
        assertThat(detail.path("lines").get(2).path("character_name").isNull()).isTrue();
        assertThat(detail.path("lines").get(2).path("in_range").booleanValue()).isTrue();
        assertThat(detail.path("lines").get(3).path("is_mine").booleanValue()).isFalse();
        assertThat(detail.path("lines").get(4).path("in_range").booleanValue()).isFalse();

        JsonNode recording = detail.path("recordings").get(0);
        assertThat(recording.fieldNames()).toIterable().containsExactly(
                "id", "line_id", "attempt_no", "duration_ms", "created_at",
                "transcript_source", "transcript", "matched");
        assertThat(recording.path("id").textValue()).isEqualTo(playable.toString());
        assertThat(recording.path("transcript_source").textValue()).isEqualTo("stt");
        assertThat(recording.path("transcript").textValue()).isEqualTo("전사 원문");
        assertThat(recording.path("matched").booleanValue()).isFalse();
        assertThat(detail.toString()).doesNotContain(
                crossJoined.toString(), ttsLike.toString(), "reading/detail.m4a",
                "reading/cross-detail.m4a", "reading/tts-should-not-exist.m4a");

        assertThat(authorized("/v2/admin/reading-sessions/" + UUID.randomUUID(), 404))
                .isEqualTo(mapper.readTree("{\"detail\":\"reading_session_not_found\"}"));
        ReadingFixture team = insertReading(
                TEAM_USER, UUID.randomUUID(), "팀 상세", NOW.plusMinutes(20), "completed", "read");
        assertThat(authorized("/v2/admin/reading-sessions/" + team.sessionId(), 404))
                .isEqualTo(mapper.readTree("{\"detail\":\"reading_session_not_found\"}"));
        UUID deactivated = UUID.fromString("00000000-0000-4000-8000-000000000606");
        insertUser(deactivated, "closed-detail@example.com", NOW.minusHours(3));
        ReadingFixture closed = insertReading(
                deactivated, UUID.randomUUID(), "탈퇴 상세", NOW.plusMinutes(19), "completed", "read");
        jdbc.update("UPDATE users SET deactivated_at=? WHERE id=?", NOW, deactivated);
        assertThat(authorized("/v2/admin/reading-sessions/" + closed.sessionId(), 404))
                .isEqualTo(mapper.readTree("{\"detail\":\"reading_session_not_found\"}"));
        String actor = md5(REAL_USER.toString()).substring(0, 8);
        assertThat(authorized("/v2/admin/reading-sessions/" + fixture.sessionId()
                + "?exclude_actors=" + actor, 404))
                .isEqualTo(mapper.readTree("{\"detail\":\"reading_session_not_found\"}"));
    }

    @Test
    void readingPlaybackUsesM4aSignerAndHidesInactiveDetachedOrInvalidParents() throws Exception {
        UUID deactivated = UUID.fromString("00000000-0000-4000-8000-000000000605");
        insertUser(deactivated, "closed-reading@example.com", NOW.minusHours(3));
        ReadingFixture fixture = insertReading(
                REAL_USER, UUID.randomUUID(), "재생 대본", NOW.plusMinutes(10), "completed", "read");
        UUID playable = insertReadingRecording(
                REAL_USER, fixture.sessionId(), fixture.lines().get(1), "reading/playable.m4a",
                "none", null, null, NOW.plusMinutes(11));
        ReadingFixture failureFixture = insertReading(
                REAL_USER, UUID.randomUUID(), "서명 실패 대본", NOW.plusMinutes(8), "completed", "read");
        UUID signingFailure = insertReadingRecording(
                REAL_USER, failureFixture.sessionId(), failureFixture.lines().get(1), "reading/signing.fail.m4a",
                "none", null, null, NOW.plusMinutes(12));

        ReadingFixture closed = insertReading(
                deactivated, UUID.randomUUID(), "탈퇴 재생", NOW.plusMinutes(9), "completed", "read");
        UUID closedRecording = insertReadingRecording(
                deactivated, closed.sessionId(), closed.lines().get(1), "reading/closed.m4a",
                "none", null, null, NOW.plusMinutes(10));
        jdbc.update("UPDATE users SET deactivated_at=? WHERE id=?", NOW, deactivated);

        UUID detached = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO reading_recordings (
                    id,user_id,reading_session_id,line_id,request_id,attempt_no,object_key,content_type,
                    byte_size,duration_ms,transcript_source,created_at,updated_at
                ) VALUES (?, ?, NULL, NULL, ?, 1, 'reading/detached.m4a', 'audio/mp4', 10, 1000, 'none', ?, ?)
                """, detached, REAL_USER, UUID.randomUUID(), NOW, NOW);

        var response = mvc.perform(get("/v2/admin/reading-recordings/{id}/playback", playable)
                .header("Authorization", "Bearer admin-secret")).andReturn().getResponse();
        assertThat(response.getStatus()).isEqualTo(200);
        assertThat(response.getHeader("Cache-Control")).isEqualTo("private, no-store");
        assertThat(mapper.readTree(response.getContentAsString())).isEqualTo(mapper.readTree("""
                {"playback_url":"admin:reading/playable.m4a:600","expires_in":600}
                """));

        for (UUID hidden : List.of(UUID.randomUUID(), closedRecording, detached)) {
            assertThat(authorized("/v2/admin/reading-recordings/" + hidden + "/playback", 404))
                    .isEqualTo(mapper.readTree("{\"detail\":\"reading_recording_not_found\"}"));
        }
        String actor = md5(REAL_USER.toString()).substring(0, 8);
        assertThat(authorized("/v2/admin/reading-recordings/" + playable
                + "/playback?exclude_actors=" + actor, 404))
                .isEqualTo(mapper.readTree("{\"detail\":\"reading_recording_not_found\"}"));
        assertThat(authorized("/v2/admin/reading-recordings/" + signingFailure + "/playback", 503))
                .isEqualTo(mapper.readTree("{\"detail\":\"playback_unavailable\"}"));
    }

    @Test
    void readingFiltersUseBoundedValidation() throws Exception {
        assertThat(authorized("/v2/admin/reading-sessions?limit=0", 422).at("/detail/0/type").textValue())
                .isEqualTo("greater_than_equal");
        assertThat(authorized("/v2/admin/reading-sessions?limit=101", 422).at("/detail/0/type").textValue())
                .isEqualTo("less_than_equal");
        assertThat(authorized("/v2/admin/reading-sessions?limit=nope", 422).at("/detail/0/type").textValue())
                .isEqualTo("int_parsing");
        JsonNode status = authorized("/v2/admin/reading-sessions?status=paused", 422);
        assertThat(status.at("/detail/0/type").textValue()).isEqualTo("literal_error");
        assertThat(status.at("/detail/0/loc/1").textValue()).isEqualTo("status");
        assertThat(authorized("/v2/admin/reading-sessions?exclude_actors=nothex12", 422)
                .at("/detail/0/loc/1").textValue()).isEqualTo("exclude_actors");
        assertThat(authorized("/v2/admin/reading-sessions/" + UUID.randomUUID()
                + "?exclude_actors=nothex12", 422).at("/detail/0/loc/1").textValue())
                .isEqualTo("exclude_actors");
        assertThat(authorized("/v2/admin/reading-recordings/" + UUID.randomUUID()
                + "/playback?exclude_actors=nothex12", 422).at("/detail/0/loc/1").textValue())
                .isEqualTo("exclude_actors");
    }

    /**
     * ops 코어는 수집기 CORE_SQL 을 운영 DB 에서 바로 돈다. 팀 계정은 빼지 않고 표시만 하고,
     * 사람은 user_id 의 md5 앞 8자리 가명으로만 나간다 — 이메일·user_id 원본은 응답에 없다.
     */
    @Test
    void opsCoreCountsTheLiveDatabaseWithTeamFlagsAndPseudonyms() throws Exception {
        assertThat(json(mvc.perform(get("/v2/admin/ops-core")), 401))
                .isEqualTo(mapper.readTree("{\"detail\":\"Unauthorized\"}"));

        JsonNode core = authorized("/v2/admin/ops-core", 200);
        assertThat(core.path("source").textValue()).isEqualTo("live");
        assertThat(core.path("as_of").textValue()).endsWith("+09:00");

        JsonNode signups = core.path("metrics").get(0);
        assertThat(signups.path("label").textValue()).isEqualTo("가입자");
        assertThat(signups.path("total").intValue()).isEqualTo(2);
        assertThat(signups.path("total_real").intValue()).isEqualTo(1);

        JsonNode daily = core.path("daily_active");
        assertThat(daily).hasSize(42);
        int signupsReal = 0;
        for (JsonNode day : daily) {
            signupsReal += day.path("signups_real").intValue();
        }
        assertThat(signupsReal).isEqualTo(1);

        // 최근 순: 팀(10분 전) → 실제 배우 두 번째(20분 전) → 첫 번째(30분 전)
        JsonNode sessions = core.path("sessions");
        assertThat(sessions).hasSize(3);
        assertThat(sessions.get(0).path("is_team").booleanValue()).isTrue();
        JsonNode second = sessions.get(1);
        assertThat(second.path("is_team").booleanValue()).isFalse();
        assertThat(second.path("actor").textValue()).isEqualTo("배우 " + md5(REAL_USER.toString()).substring(0, 8));
        assertThat(second.path("nth").intValue()).isEqualTo(2);
        assertThat(second.path("total").intValue()).isEqualTo(2);
        assertThat(second.path("coach_session_id").textValue()).isEqualTo(realPendingCoach.toString());
        assertThat(second.path("coach_status").textValue()).isEqualTo("open");
        assertThat(second.path("turns_ai").intValue()).isEqualTo(1);
        JsonNode first = sessions.get(2);
        assertThat(first.path("coach_status").textValue()).isEqualTo("closed");
        assertThat(first.path("close_reason").textValue()).isEqualTo("gap_stated");
        assertThat(first.path("turns_actor").intValue()).isEqualTo(1);

        JsonNode activities = core.path("activity_rows");
        assertThat(activities).hasSize(2);
        JsonNode newestActivity = activities.get(0);
        assertThat(newestActivity.fieldNames()).toIterable().containsExactly(
                "activity_id", "feature", "created_at", "actor", "signup_at", "signup_d7",
                "platform", "device", "status", "is_team");
        assertThat(newestActivity.path("feature").textValue()).isEqualTo("coaching");
        assertThat(newestActivity.path("created_at").textValue()).isEqualTo(utc(NOW.minusMinutes(20).truncatedTo(ChronoUnit.MINUTES)));
        assertThat(newestActivity.path("signup_at").textValue()).isEqualTo(utc(NOW.minusHours(2).truncatedTo(ChronoUnit.HOURS)));
        assertThat(newestActivity.path("signup_d7").booleanValue()).isTrue();
        assertThat(newestActivity.path("platform").textValue()).isEqualTo("웹");
        assertThat(newestActivity.path("device").textValue()).isEqualTo("기록 없음");
        assertThat(newestActivity.path("status").textValue()).isEqualTo("analyzed");
        assertThat(newestActivity.path("is_team").booleanValue()).isFalse();
        for (JsonNode activity : activities) {
            assertThat(activity.path("actor").textValue())
                    .isEqualTo("배우 " + md5(REAL_USER.toString()).substring(0, 8));
        }

        assertThat(core.toString()).doesNotContain(
                "actor@example.com", "Team@Acttub.com", REAL_USER.toString(), TEAM_USER.toString());
    }

    /**
     * 0.1.0 은 연습을 practices · coach_conversations · coach_messages · analyses 에 쓴다(SOMA-566). ops 코어와
     * 세션 목록은 새 표 전부와 아직 옮겨지지 않은 옛 행을 함께 읽는다. 이관은 같은 id 로 옮기므로 옮겨진
     * 옛 행(여기서는 realFinal)은 한 번만 센다.
     */
    @Test
    void opsCoreAndSessionsReadThePractice1TablesWithoutDoubleCountingMigratedRows() throws Exception {
        UUID migratedPractice = jdbc.queryForObject(
                "SELECT practice_session_id FROM coach_sessions WHERE id=?", UUID.class, realFinalCoach);
        UUID migratedVideo = insertVideo(REAL_USER, "real-v.mp4", NOW.minusMinutes(30));
        insertPractice1(migratedPractice, REAL_USER, migratedVideo, "closed", "conversation_closed",
                "legacy", NOW.minusMinutes(30));
        insertConversation(realFinalCoach, migratedPractice, "closed", "gap_stated", NOW.minusMinutes(30));
        insertMessage(realFinalCoach, 0, "actor", "첫 질문");

        UUID newVideo = insertVideo(REAL_USER, "new.mp4", NOW.minusMinutes(5));
        UUID newPractice = UUID.randomUUID();
        insertPractice1(newPractice, REAL_USER, newVideo, "conversing", null, "three_layers_v1", NOW.minusMinutes(5));
        jdbc.update("""
                INSERT INTO analyses (id,practice_id,format,status,model,record,created_at,completed_at)
                VALUES (?, ?, 'video_record_v1', 'ready', 'gemini-test', '{}'::jsonb, ?, ?)
                """, UUID.randomUUID(), newPractice, NOW.minusMinutes(5), NOW.minusMinutes(5));
        UUID newConversation = UUID.randomUUID();
        insertConversation(newConversation, newPractice, "open", null, NOW.minusMinutes(4));
        insertMessage(newConversation, 1, "actor", "0.1.0 답");
        insertMessage(newConversation, 0, "ai", "0.1.0 질문");

        JsonNode core = authorized("/v2/admin/ops-core", 200);
        JsonNode practices = core.path("metrics").get(1);
        assertThat(practices.path("label").textValue()).isEqualTo("연습 세션");
        assertThat(practices.path("total").intValue()).isEqualTo(4);
        assertThat(practices.path("total_real").intValue()).isEqualTo(3);
        assertThat(core.path("metrics").get(2).path("total").intValue()).isEqualTo(4);

        JsonNode sessions = core.path("sessions");
        assertThat(sessions).hasSize(4);
        JsonNode newest = sessions.get(0);
        assertThat(newest.path("practice_session_id").textValue()).isEqualTo(newPractice.toString());
        assertThat(newest.path("coach_session_id").textValue()).isEqualTo(newConversation.toString());
        assertThat(newest.path("status").textValue()).isEqualTo("analyzed");
        assertThat(newest.path("has_summary").booleanValue()).isTrue();
        assertThat(newest.path("continued").booleanValue()).isFalse();
        assertThat(newest.path("nth").intValue()).isEqualTo(3);
        assertThat(newest.path("turns_actor").intValue()).isEqualTo(1);
        assertThat(newest.path("turns_ai").intValue()).isEqualTo(1);
        JsonNode migrated = sessions.get(3);
        assertThat(migrated.path("practice_session_id").textValue()).isEqualTo(migratedPractice.toString());
        assertThat(migrated.path("coach_status").textValue()).isEqualTo("closed");
        assertThat(migrated.path("turns_actor").intValue()).isEqualTo(1);

        JsonNode list = authorized("/v2/admin/sessions", 200).path("sessions");
        assertThat(list).hasSize(3);
        assertThat(list.get(0).path("coach_session_id").textValue()).isEqualTo(newConversation.toString());
        assertThat(list.get(0).path("video_url").textValue()).isEqualTo("admin:new.mp4:3600");
        assertThat(list.get(0).path("turns")).isEqualTo(mapper.readTree("""
                [{"turn_index":0,"role":"ai","text":"0.1.0 질문"},
                 {"turn_index":1,"role":"actor","text":"0.1.0 답"}]
                """));
        JsonNode moved = list.get(2);
        assertThat(moved.path("coach_session_id").textValue()).isEqualTo(realFinalCoach.toString());
        assertThat(moved.path("video_url").textValue()).isEqualTo("admin:real-v.mp4:3600");
        assertThat(moved.path("turns")).hasSize(1);

        JsonNode activities = core.path("activity_rows");
        assertThat(activities).hasSize(3);
        String migratedActivityId = "coaching:" + migratedPractice;
        int migratedRows = 0;
        for (JsonNode activity : activities) {
            if (activity.path("activity_id").textValue().equals(migratedActivityId)) {
                migratedRows++;
            }
        }
        assertThat(migratedRows).isEqualTo(1);
    }

    @Test
    void opsCoreActivityRowsUnifyFeaturesAndExcludeTeamDeletedAndFutureRows() throws Exception {
        jdbc.update("UPDATE users SET created_at=?, updated_at=? WHERE id=?",
                NOW.minusYears(2), NOW.minusYears(2), REAL_USER);
        UUID oldReading = insertReadingSession(
                REAL_USER, NOW.minusYears(1), "오래된 리딩 자유텍스트", "stopped");
        UUID realReading = insertReadingSession(
                REAL_USER, NOW.minusMinutes(40), "리딩 자유텍스트 비밀", "completed");
        UUID teamReading = insertReadingSession(
                TEAM_USER, NOW.minusMinutes(35), "팀 리딩 자유텍스트", "completed");
        UUID futureReading = insertReadingSession(
                REAL_USER, NOW.plusDays(1), "미래 리딩 자유텍스트", "completed");

        UUID challenge = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO challenges (id,line,work,duration_days,origin,request_id,request_fingerprint,starts_at,ends_at)
                VALUES (?, '챌린지 대사 비밀', '작품 비밀', 7, 'team', ?, ?, ?, ?)
                """, challenge, UUID.randomUUID(), "d".repeat(64), NOW.minusDays(1), NOW.plusDays(6));
        UUID realEntry = insertChallengeEntry(challenge, REAL_USER, "real-entry.mp4", "챌린지 캡션 비밀",
                "visible", NOW.minusMinutes(10), null);
        UUID teamEntry = insertChallengeEntry(challenge, TEAM_USER, "team-entry.mp4", "팀 캡션 비밀",
                "visible", NOW.minusMinutes(9), null);
        UUID futureEntry = insertChallengeEntry(challenge, REAL_USER, "future-entry.mp4", "미래 캡션 비밀",
                "visible", NOW.plusDays(1), null);
        UUID deletedEntry = insertChallengeEntry(challenge, REAL_USER, null, null,
                "deleted", NOW.minusMinutes(8), NOW.minusMinutes(7));
        UUID futureCoaching = insertPractice(
                REAL_USER, "future-coaching.mp4", "finalized", NOW.plusDays(1));

        JsonNode activities = authorized("/v2/admin/ops-core", 200).path("activity_rows");
        assertThat(activities).hasSize(5);
        assertThat(activities.toString()).doesNotContain(
                teamReading.toString(), futureReading.toString(), teamEntry.toString(),
                futureEntry.toString(), deletedEntry.toString(), futureCoaching.toString(),
                "오래된 리딩 자유텍스트", "리딩 자유텍스트 비밀", "팀 리딩 자유텍스트", "미래 리딩 자유텍스트",
                "대사 자유텍스트", "챌린지 대사 비밀", "작품 비밀",
                "챌린지 캡션 비밀", "팀 캡션 비밀", "미래 캡션 비밀",
                "actor@example.com", "Team@Acttub.com", REAL_USER.toString(), TEAM_USER.toString());

        String actor = "배우 " + md5(REAL_USER.toString()).substring(0, 8);
        int coaching = 0;
        int reading = 0;
        int challengeEntries = 0;
        for (JsonNode activity : activities) {
            assertThat(activity.path("actor").textValue()).isEqualTo(actor);
            assertThat(activity.path("signup_d7").booleanValue()).isFalse();
            assertThat(activity.path("is_team").booleanValue()).isFalse();
            assertThat(activity.fieldNames()).toIterable().containsExactly(
                    "activity_id", "feature", "created_at", "actor", "signup_at", "signup_d7",
                    "platform", "device", "status", "is_team");
            switch (activity.path("feature").textValue()) {
                case "coaching" -> coaching++;
                case "reading" -> reading++;
                case "challenge" -> challengeEntries++;
                default -> throw new AssertionError("unexpected activity feature: " + activity);
            }
        }
        assertThat(coaching).isEqualTo(2);
        assertThat(reading).isEqualTo(2);
        assertThat(challengeEntries).isEqualTo(1);

        JsonNode oldReadingRow = findActivity(activities, "reading:" + oldReading);
        assertThat(oldReadingRow.path("created_at").textValue()).isEqualTo(utc(NOW.minusYears(1).truncatedTo(ChronoUnit.MINUTES)));
        assertThat(oldReadingRow.path("status").textValue()).isEqualTo("stopped");
        JsonNode readingRow = findActivity(activities, "reading:" + realReading);
        assertThat(readingRow.path("created_at").textValue()).isEqualTo(utc(NOW.minusMinutes(40).truncatedTo(ChronoUnit.MINUTES)));
        assertThat(readingRow.path("status").textValue()).isEqualTo("completed");
        JsonNode challengeRow = findActivity(activities, "challenge:" + realEntry);
        assertThat(challengeRow.path("created_at").textValue()).isEqualTo(utc(NOW.minusMinutes(10).truncatedTo(ChronoUnit.MINUTES)));
        assertThat(challengeRow.path("status").textValue()).isEqualTo("visible");
    }

    @Test
    void opsCoreRecentChallengeEntriesExcludeTeamDeletedFutureRowsAndCaptions() throws Exception {
        UUID challenge = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO challenges (id,line,work,duration_days,origin,request_id,request_fingerprint,starts_at,ends_at)
                VALUES (?, '챌린지 대사 비밀', '작품 비밀', 7, 'member', ?, ?, ?, ?)
                """, challenge, UUID.randomUUID(), "f".repeat(64), NOW.minusDays(1), NOW.plusDays(6));
        UUID realEntry = insertChallengeEntry(challenge, REAL_USER, "real-entry.mp4", "챌린지 캡션 비밀",
                "visible", NOW.minusMinutes(10), null);
        UUID hiddenEntry = insertChallengeEntry(challenge, REAL_USER, "hidden-entry.mp4", "숨긴 캡션 비밀",
                "hidden_by_report", NOW.minusMinutes(20), null);
        UUID teamEntry = insertChallengeEntry(challenge, TEAM_USER, "team-entry.mp4", "팀 캡션 비밀",
                "visible", NOW.minusMinutes(9), null);
        UUID futureEntry = insertChallengeEntry(challenge, REAL_USER, "future-entry.mp4", "미래 캡션 비밀",
                "visible", NOW.plusDays(1), null);
        UUID deletedEntry = insertChallengeEntry(challenge, REAL_USER, null, null,
                "deleted", NOW.minusMinutes(8), NOW.minusMinutes(7));

        JsonNode challenges = authorized("/v2/admin/ops-core", 200).at("/features/challenges");
        // 합계는 기존처럼 미래 시각 행도 센다(팀·삭제만 뺀다). 목록은 activity_rows 와 같이 미래 행을 뺀다.
        assertThat(challenges.at("/entries/total").intValue()).isEqualTo(3);
        assertThat(challenges.at("/entries/private").intValue()).isEqualTo(3);
        assertThat(challenges.at("/entries/public").intValue()).isEqualTo(0);
        JsonNode recent = challenges.path("recent_entries");
        assertThat(recent).hasSize(2);
        assertThat(recent.get(0).path("entry_id").textValue()).isEqualTo(realEntry.toString().substring(0, 8));
        assertThat(recent.get(0).path("challenge_origin").textValue()).isEqualTo("member");
        assertThat(recent.get(1).path("entry_id").textValue()).isEqualTo(hiddenEntry.toString().substring(0, 8));
        assertThat(recent.get(1).path("status").textValue()).isEqualTo("hidden_by_report");
        assertThat(recent.toString()).doesNotContain(
                teamEntry.toString().substring(0, 8), futureEntry.toString().substring(0, 8),
                deletedEntry.toString().substring(0, 8),
                "챌린지 대사 비밀", "작품 비밀", "챌린지 캡션 비밀", "숨긴 캡션 비밀", "팀 캡션 비밀", "미래 캡션 비밀",
                "actor@example.com", "Team@Acttub.com", REAL_USER.toString(), TEAM_USER.toString());
    }

    @Test
    void opsCoreActivitySignupCohortUsesUnroundedTimestamp() throws Exception {
        jdbc.update("UPDATE users SET created_at=now()-interval '7 days'+interval '15 minutes' WHERE id=?", REAL_USER);
        JsonNode inside = authorized("/v2/admin/ops-core", 200).path("activity_rows");
        assertThat(inside).hasSize(2);
        for (JsonNode row : inside) assertThat(row.path("signup_d7").booleanValue()).isTrue();
        jdbc.update("UPDATE users SET created_at=now()-interval '7 days'-interval '15 minutes' WHERE id=?", REAL_USER);
        JsonNode outside = authorized("/v2/admin/ops-core", 200).path("activity_rows");
        assertThat(outside).hasSize(2);
        for (JsonNode row : outside) assertThat(row.path("signup_d7").booleanValue()).isFalse();
    }

    @Test
    void opsCoreActivityRowsAreAnEmptyArrayWhenThereAreNoActivities() throws Exception {
        jdbc.execute("TRUNCATE TABLE practices, practice_sessions, reading_sessions, challenge_entries CASCADE");

        JsonNode activities = authorized("/v2/admin/ops-core", 200).path("activity_rows");
        assertThat(activities).isEqualTo(mapper.readTree("[]"));
    }

    private UUID insertVideo(UUID userId, String objectKey, OffsetDateTime createdAt) {
        UUID id = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO videos (id,user_id,object_key,content_type,byte_size,duration_ms,created_at,updated_at)
                VALUES (?, ?, ?, 'video/mp4', 1, 1000, ?, ?)
                """, id, userId, objectKey, createdAt, createdAt);
        return id;
    }

    private void insertPractice1(
            UUID id, UUID userId, UUID videoId, String stage, String closeReason,
            String experienceVersion, OffsetDateTime createdAt) {
        jdbc.update("""
                INSERT INTO practices (
                    id,user_id,video_id,root_id,ordinal,stage,close_reason,experience_version,
                    blockage_kind,sub_branch,created_at,updated_at
                ) VALUES (?, ?, ?, ?, 1, ?, ?, ?, '분석', '캐릭터 분석', ?, ?)
                """, id, userId, videoId, id, stage, closeReason, experienceVersion, createdAt, createdAt);
    }

    private void insertConversation(
            UUID id, UUID practiceId, String status, String closeReason, OffsetDateTime createdAt) {
        jdbc.update("""
                INSERT INTO coach_conversations (
                    id,practice_id,start_request_id,status,close_reason,created_at,updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """, id, practiceId, id, status, closeReason, createdAt, createdAt);
    }

    private void insertMessage(UUID conversationId, int index, String role, String text) {
        jdbc.update("""
                INSERT INTO coach_messages (id,conversation_id,turn_index,role,text,created_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """, UUID.randomUUID(), conversationId, index, role, text, NOW);
    }

    /** 이메일이 없는 게스트도 화면의 가명으로 팀에 넣는다(SOMA-569). 형식이 틀리면 422. */
    @Test
    void opsCoreTreatsExcludedActorPseudonymsAsTeam() throws Exception {
        String realActor = md5(REAL_USER.toString()).substring(0, 8);
        JsonNode core = authorized("/v2/admin/ops-core?exclude_actors=" + realActor.toUpperCase() + "," + realActor, 200);
        JsonNode signups = core.path("metrics").get(0);
        assertThat(signups.path("total").intValue()).isEqualTo(2);
        assertThat(signups.path("total_real").intValue()).isEqualTo(0);
        for (JsonNode session : core.path("sessions")) {
            assertThat(session.path("is_team").booleanValue()).isTrue();
        }
        assertThat(core.at("/devices/team_excluded").intValue()).isEqualTo(2);
        assertThat(core.path("activity_rows")).isEqualTo(mapper.readTree("[]"));

        JsonNode none = authorized("/v2/admin/ops-core?exclude_actors=", 200);
        assertThat(none.path("metrics").get(0).path("total_real").intValue()).isEqualTo(1);

        JsonNode invalid = authorized("/v2/admin/ops-core?exclude_actors=nothex12", 422);
        assertThat(invalid.at("/detail/0/loc/1").textValue()).isEqualTo("exclude_actors");
        JsonNode injected = authorized("/v2/admin/ops-core?exclude_actors=" + realActor + "'--", 422);
        assertThat(injected.at("/detail/0/type").textValue()).isEqualTo("value_error");
    }

    /**
     * 기능별 사용(SOMA-570): 대본 리딩·챌린지·노트 평가·이탈 설문을 팀 제외로 센다. 자유 글(설문 본문·연락처·
     * 평가 코멘트·대본)은 응답에 실리지 않는다 — 이 JSON 은 수집기를 거쳐 git 에 남는다.
     */
    @Test
    void opsCoreCountsFeatureUsageWithoutFreeText() throws Exception {
        UUID script = insertScript(REAL_USER, "sample", "비밀 대본 본문");
        insertScript(TEAM_USER, "paste", "팀 대본");
        UUID character = UUID.randomUUID();
        jdbc.update("INSERT INTO script_characters (id,script_id,name,sort_order) VALUES (?,?,'수아',0)", character, script);
        UUID line1 = UUID.randomUUID();
        UUID line2 = UUID.randomUUID();
        jdbc.update("INSERT INTO script_lines (id,script_id,ordinal,kind,character_id,text) VALUES (?,?,1,'dialogue',?,'됐어')",
                line1, script, character);
        jdbc.update("INSERT INTO script_lines (id,script_id,ordinal,kind,character_id,text) VALUES (?,?,2,'dialogue',?,'가')",
                line2, script, character);
        UUID reading = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO reading_sessions (
                    id,script_id,user_id,my_character_ids,mode,start_line_id,end_line_id,advance,record,status,
                    elapsed_seconds,started_at,ended_at,updated_at
                ) VALUES (?, ?, ?, ARRAY[CAST(? AS uuid)], 'read', ?, ?, 'manual', true, 'completed', 120, ?, ?, ?)
                """, reading, script, REAL_USER, character, line1, line2, NOW.minusMinutes(40), NOW.minusMinutes(38), NOW);
        jdbc.update("""
                INSERT INTO reading_recordings (
                    id,user_id,reading_session_id,line_id,request_id,attempt_no,object_key,content_type,byte_size,
                    duration_ms,transcript_source,matched,created_at,updated_at
                ) VALUES (?, ?, ?, ?, ?, 1, 'rec.m4a', 'audio/mp4', 1, 3000, 'none', true, ?, ?)
                """, UUID.randomUUID(), REAL_USER, reading, line1, UUID.randomUUID(), NOW.minusMinutes(39), NOW);
        jdbc.update("INSERT INTO line_memorization (id,user_id,line_id,status) VALUES (?,?,?,'memorized')",
                UUID.randomUUID(), REAL_USER, line1);

        UUID video = insertVideo(REAL_USER, "note.mp4", NOW.minusMinutes(15));
        UUID practice = UUID.randomUUID();
        insertPractice1(practice, REAL_USER, video, "closed", "conversation_closed", "three_layers_v1", NOW.minusMinutes(15));
        UUID conversation = UUID.randomUUID();
        insertConversation(conversation, practice, "closed", "gap_stated", NOW.minusMinutes(14));
        UUID note = UUID.randomUUID();
        jdbc.update("INSERT INTO coach_notes (id,conversation_id,format,kind,source_revision) VALUES (?,?,'v2','action',0)",
                note, conversation);
        jdbc.update("""
                INSERT INTO note_ratings (id,practice_id,note_id,user_id,rating,comment,request_id)
                VALUES (?, ?, ?, ?, 'not_helpful', '평가 코멘트 비밀', ?)
                """, UUID.randomUUID(), practice, note, REAL_USER, UUID.randomUUID());
        jdbc.update("""
                INSERT INTO practice_feedback (id,user_id,practice_id,screen,trigger,body,contact_email)
                VALUES (?, ?, ?, 'coach', 'x', '설문 본문 비밀', 'secret@example.com')
                """, UUID.randomUUID(), REAL_USER, practice);

        UUID challenge = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO challenges (id,line,work,duration_days,origin,request_id,request_fingerprint,starts_at,ends_at)
                VALUES (?, '됐어, 그냥 가', '작품', 7, 'team', ?, ?, ?, ?)
                """, challenge, UUID.randomUUID(), "a".repeat(64), NOW.minusDays(1), NOW.plusDays(6));
        UUID entryVideo = insertVideo(REAL_USER, "entry.mp4", NOW.minusMinutes(10));
        UUID entry = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO challenge_entries (id,challenge_id,user_id,video_id,visibility,request_id,request_fingerprint,created_at)
                VALUES (?, ?, ?, ?, 'private', ?, ?, ?)
                """, entry, challenge, REAL_USER, entryVideo, UUID.randomUUID(), "b".repeat(64), NOW.minusMinutes(10));
        jdbc.update("INSERT INTO entry_likes (id,entry_id,user_id) VALUES (?,?,?)", UUID.randomUUID(), entry, REAL_USER);
        jdbc.update("INSERT INTO entry_likes (id,entry_id,user_id) VALUES (?,?,?)", UUID.randomUUID(), entry, TEAM_USER);
        jdbc.update("INSERT INTO entry_view_events (event_id,entry_id,user_id) VALUES (?,?,?)", UUID.randomUUID(), entry, REAL_USER);

        JsonNode features = authorized("/v2/admin/ops-core", 200).path("features");
        JsonNode reading1 = features.path("reading");
        assertThat(reading1.at("/scripts/total").intValue()).isEqualTo(1);
        assertThat(reading1.at("/scripts/sample").intValue()).isEqualTo(1);
        assertThat(reading1.at("/sessions/total").intValue()).isEqualTo(1);
        assertThat(reading1.at("/sessions/completed").intValue()).isEqualTo(1);
        assertThat(reading1.at("/sessions/avg_minutes").doubleValue()).isEqualTo(2.0);
        assertThat(reading1.at("/recordings/matched").intValue()).isEqualTo(1);
        assertThat(reading1.at("/memorization/memorized").intValue()).isEqualTo(1);
        assertThat(reading1.path("daily")).hasSize(42);
        int dailySessions = 0;
        for (JsonNode day : reading1.path("daily")) {
            dailySessions += day.path("sessions").intValue();
        }
        assertThat(dailySessions).isEqualTo(1);

        JsonNode challenges = features.path("challenges");
        assertThat(challenges.at("/challenges/active").intValue()).isEqualTo(1);
        assertThat(challenges.at("/entries/total").intValue()).isEqualTo(1);
        assertThat(challenges.at("/entries/public").intValue()).isEqualTo(0);
        assertThat(challenges.at("/entries/private").intValue()).isEqualTo(1);
        assertThat(challenges.at("/likes/total").intValue()).isEqualTo(1);
        assertThat(challenges.at("/views/total").intValue()).isEqualTo(1);
        JsonNode recent = challenges.path("recent_entries");
        assertThat(recent).hasSize(1);
        JsonNode recentEntry = recent.get(0);
        assertThat(recentEntry.fieldNames()).toIterable().containsExactlyInAnyOrder(
                "entry_id", "challenge_id", "challenge_origin", "actor", "visibility", "status", "has_video",
                "created_at", "published_at", "views", "likes", "comments", "ai_report");
        assertThat(recentEntry.path("entry_id").textValue()).isEqualTo(entry.toString().substring(0, 8));
        assertThat(recentEntry.path("challenge_id").textValue()).isEqualTo(challenge.toString().substring(0, 8));
        assertThat(recentEntry.path("challenge_origin").textValue()).isEqualTo("team");
        assertThat(recentEntry.path("actor").textValue()).isEqualTo("배우 " + md5(REAL_USER.toString()).substring(0, 8));
        assertThat(recentEntry.path("visibility").textValue()).isEqualTo("private");
        assertThat(recentEntry.path("status").textValue()).isEqualTo("visible");
        assertThat(recentEntry.path("has_video").booleanValue()).isTrue();
        assertThat(recentEntry.path("created_at").textValue()).isEqualTo(utc(NOW.minusMinutes(10).truncatedTo(ChronoUnit.MINUTES)));
        assertThat(recentEntry.path("published_at").isNull()).isTrue();
        assertThat(recentEntry.path("views").intValue()).isEqualTo(0);
        assertThat(recentEntry.path("likes").intValue()).isEqualTo(1);
        assertThat(recentEntry.path("comments").intValue()).isEqualTo(0);
        assertThat(recentEntry.path("ai_report").isNull()).isTrue();

        JsonNode feedback = features.path("feedback");
        assertThat(feedback.at("/notes/total").intValue()).isEqualTo(1);
        assertThat(feedback.at("/notes/action").intValue()).isEqualTo(1);
        assertThat(feedback.at("/ratings/not_helpful").intValue()).isEqualTo(1);
        assertThat(feedback.at("/ratings/with_comment").intValue()).isEqualTo(1);
        assertThat(feedback.at("/exit_survey/answered").intValue()).isEqualTo(1);
        assertThat(feedback.at("/exit_survey/with_contact").intValue()).isEqualTo(1);
        assertThat(feedback.at("/exit_survey/x").intValue()).isEqualTo(1);
        assertThat(features.at("/accounts/withdrawn").intValue()).isEqualTo(0);

        assertThat(features.toString()).doesNotContain(
                "설문 본문 비밀", "secret@example.com", "평가 코멘트 비밀", "비밀 대본 본문", "됐어, 그냥 가");
    }

    private UUID insertScript(UUID userId, String source, String rawText) {
        UUID id = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO scripts (id,user_id,title,raw_text,source,request_id,request_fingerprint)
                VALUES (?, ?, '제목', ?, ?, ?, ?)
                """, id, userId, rawText, source, UUID.randomUUID(), "c".repeat(64));
        return id;
    }

    private UUID insertReadingSession(
            UUID userId, OffsetDateTime startedAt, String rawText, String status) {
        UUID script = insertScript(userId, "typed", rawText);
        UUID character = UUID.randomUUID();
        jdbc.update("INSERT INTO script_characters (id,script_id,name,sort_order) VALUES (?,?,'배역',0)",
                character, script);
        UUID line = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO script_lines (id,script_id,ordinal,kind,character_id,text)
                VALUES (?,?,1,'dialogue',?,'대사 자유텍스트')
                """, line, script, character);
        UUID reading = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO reading_sessions (
                    id,script_id,user_id,my_character_ids,mode,start_line_id,end_line_id,advance,record,status,
                    elapsed_seconds,started_at,ended_at,updated_at
                ) VALUES (?, ?, ?, ARRAY[CAST(? AS uuid)], 'read', ?, ?, 'manual', false, ?, 60, ?, ?, ?)
                """, reading, script, userId, character, line, line, status,
                startedAt, startedAt.plusMinutes(1), startedAt.plusMinutes(1));
        return reading;
    }

    private UUID insertChallenge(String origin, OffsetDateTime deletedAt) {
        UUID challenge = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO challenges (
                    id,line,work,duration_days,origin,request_id,request_fingerprint,
                    starts_at,ends_at,deleted_at
                ) VALUES (?, '챌린지 대사 비밀', '작품 비밀', 7, ?, ?, ?, ?, ?, ?)
                """, challenge, origin, UUID.randomUUID(), "d".repeat(64),
                NOW.minusDays(1), NOW.plusDays(6), deletedAt);
        return challenge;
    }

    private UUID insertChallengeEntry(
            UUID challengeId, UUID userId, String objectKey, String caption,
            String status, OffsetDateTime createdAt, OffsetDateTime deletedAt) {
        return insertChallengeEntry(
                challengeId, userId, objectKey, caption, "private", status, createdAt, deletedAt);
    }

    private UUID insertChallengeEntry(
            UUID challengeId, UUID userId, String objectKey, String caption,
            String visibility, String status, OffsetDateTime createdAt, OffsetDateTime deletedAt) {
        UUID videoId = objectKey == null ? null : insertVideo(userId, objectKey, createdAt);
        UUID entry = UUID.randomUUID();
        OffsetDateTime publishedAt = "public".equals(visibility) ? createdAt : null;
        jdbc.update("""
                INSERT INTO challenge_entries (
                    id,challenge_id,user_id,video_id,caption,published_at,visibility,status,
                    request_id,request_fingerprint,created_at,updated_at,deleted_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, entry, challengeId, userId, videoId, caption, publishedAt, visibility, status,
                UUID.randomUUID(), "e".repeat(64), createdAt, createdAt, deletedAt);
        return entry;
    }

    private ReadingFixture insertReading(
            UUID userId,
            UUID sessionId,
            String title,
            OffsetDateTime startedAt,
            String status,
            String mode) {
        UUID scriptId = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO scripts (
                    id,user_id,title,raw_text,source,request_id,request_fingerprint,created_at,updated_at
                ) VALUES (?, ?, ?, '대본 원문 비밀', 'typed', ?, ?, ?, ?)
                """, scriptId, userId, title, UUID.randomUUID(), "a".repeat(64), startedAt, startedAt);
        UUID mine = UUID.randomUUID();
        UUID other = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO script_characters (id,script_id,name,sort_order,created_at,updated_at)
                VALUES (?, ?, '나', 0, ?, ?), (?, ?, '상대', 1, ?, ?)
                """, mine, scriptId, startedAt, startedAt, other, scriptId, startedAt, startedAt);
        List<UUID> lines = List.of(
                UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID());
        jdbc.update("""
                INSERT INTO script_lines (id,script_id,ordinal,kind,character_id,text,created_at)
                VALUES
                    (?, ?, 1, 'scene', NULL, '1막', ?),
                    (?, ?, 2, 'dialogue', ?, '내 대사', ?),
                    (?, ?, 3, 'direction', NULL, '지문', ?),
                    (?, ?, 4, 'dialogue', ?, '상대 대사', ?),
                    (?, ?, 5, 'scene', NULL, '2막', ?)
                """,
                lines.get(0), scriptId, startedAt,
                lines.get(1), scriptId, mine, startedAt,
                lines.get(2), scriptId, startedAt,
                lines.get(3), scriptId, other, startedAt,
                lines.get(4), scriptId, startedAt);
        OffsetDateTime endedAt = "in_progress".equals(status) ? null : startedAt.plusMinutes(3);
        jdbc.update("""
                INSERT INTO reading_sessions (
                    id,script_id,user_id,request_id,my_character_ids,mode,start_line_id,end_line_id,
                    advance,record,status,current_line_id,elapsed_seconds,progress_seq,line_results,
                    started_at,ended_at,updated_at
                ) VALUES (?, ?, ?, ?, CAST(? AS uuid[]), ?, ?, ?, 'manual', true, ?, NULL, 180, 1,
                    '[]'::jsonb, ?, ?, ?)
                """, sessionId, scriptId, userId, UUID.randomUUID(), "{" + mine + "}", mode,
                lines.get(1), lines.get(3), status, startedAt, endedAt, startedAt);
        return new ReadingFixture(scriptId, sessionId, mine, other, lines);
    }

    private UUID insertReadingRecording(
            UUID userId,
            UUID sessionId,
            UUID lineId,
            String objectKey,
            String transcriptSource,
            String transcript,
            Boolean matched,
            OffsetDateTime createdAt) {
        UUID id = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO reading_recordings (
                    id,user_id,reading_session_id,line_id,request_id,attempt_no,object_key,content_type,
                    byte_size,duration_ms,transcript,transcript_source,matched,created_at,updated_at
                ) VALUES (?, ?, ?, ?, ?, 1, ?, 'audio/mp4', 10, 1500, ?, ?, ?, ?, ?)
                """, id, userId, sessionId, lineId, UUID.randomUUID(), objectKey,
                transcript, transcriptSource, matched, createdAt, createdAt);
        return id;
    }

    private record ReadingFixture(
            UUID scriptId,
            UUID sessionId,
            UUID mineCharacter,
            UUID otherCharacter,
            List<UUID> lines) {
    }

    private static JsonNode findActivity(JsonNode activities, String activityId) {
        for (JsonNode activity : activities) {
            if (activity.path("activity_id").textValue().equals(activityId)) {
                return activity;
            }
        }
        throw new AssertionError("activity not found: " + activityId);
    }

    private static String utc(OffsetDateTime value) {
        return value.withOffsetSameInstant(ZoneOffset.UTC)
                .format(DateTimeFormatter.ofPattern("uuuu-MM-dd'T'HH:mm:ss.SSSSSS'Z'"));
    }

    private static String md5(String value) throws Exception {
        return HexFormat.of().formatHex(
                MessageDigest.getInstance("MD5").digest(value.getBytes(StandardCharsets.UTF_8)));
    }

    /**
     * 관리자 경로는 <b>커밋된 스펙에 없다</b> — 조건부 빈이라 토큰 없이 뜨는 기본 컨텍스트의
     * springdoc 출력에 나오지 않고, 그래서 {@code OpenApiSnapshotIT} 도 여기를 못 본다.
     * 관리자를 켠 이 컨텍스트가 스펙에 <b>정확히 무엇을 더하는지</b>는 여기서만 센다.
     */
    @Test
    void adminProfileAddsExactlyItsConditionalInventoryAndKeepsIntegerLimitSchema()
            throws Exception {
        JsonNode actual = json(mvc.perform(get("/v3/api-docs")), 200);
        JsonNode committed = mapper.readTree(Path.of("spec/openapi.json").toFile());
        Set<String> added = new HashSet<>();
        actual.path("paths").fieldNames().forEachRemaining(path -> {
            if (!committed.path("paths").has(path)) {
                added.add(path);
            }
        });
        assertThat(added).containsExactlyInAnyOrder("/v2/admin/sessions", "/v2/admin/ops-core",
                "/v2/admin/feedback", "/v2/admin/practice-migration",
                "/v2/admin/challenges", "/v2/admin/challenges/{id}/moderation",
                "/v2/admin/reports", "/v2/admin/reports/{id}",
                "/v2/admin/challenge-videos", "/v2/admin/challenge-videos/{id}/playback",
                "/v2/admin/reading-sessions", "/v2/admin/reading-sessions/{id}",
                "/v2/admin/reading-recordings/{id}/playback");
        assertThat(actual.at("/paths/~1v2~1admin~1sessions/get/parameters/0/schema/type")
                .textValue()).isEqualTo("integer");
        assertThat(actual.at("/paths/~1v2~1admin~1sessions/get/parameters/0/schema/default")
                .intValue()).isEqualTo(20);
        assertThat(actual.at("/paths/~1v2~1admin~1feedback/get/parameters/0/schema/maximum")
                .intValue()).isEqualTo(100);
        assertThat(actual.at("/paths/~1v2~1admin~1feedback/get/responses/200/content/application~1json/schema/$ref")
                .textValue()).isEqualTo("#/components/schemas/AdminFeedbackPage");
        assertThat(actual.at("/paths/~1v2~1admin~1challenge-videos/get/parameters/0/schema/maximum")
                .intValue()).isEqualTo(100);
        assertThat(actual.at("/paths/~1v2~1admin~1challenge-videos/get/responses/200/content/application~1json/schema/$ref")
                .textValue()).isEqualTo("#/components/schemas/AdminChallengeVideoPage");
        assertThat(actual.at("/paths/~1v2~1admin~1challenge-videos~1{id}~1playback/get/responses/200/content/application~1json/schema/$ref")
                .textValue()).isEqualTo("#/components/schemas/AdminChallengePlayback");
        assertThat(actual.at("/paths/~1v2~1admin~1reading-sessions/get/parameters/0/schema/default")
                .intValue()).isEqualTo(50);
        assertThat(actual.at("/paths/~1v2~1admin~1reading-sessions/get/parameters/0/schema/maximum")
                .intValue()).isEqualTo(100);
        assertThat(actual.at("/paths/~1v2~1admin~1reading-sessions/get/responses/200/content/application~1json/schema/$ref")
                .textValue()).isEqualTo("#/components/schemas/AdminReadingSessionPage");
        assertThat(actual.at("/paths/~1v2~1admin~1reading-sessions~1{id}/get/responses/200/content/application~1json/schema/$ref")
                .textValue()).isEqualTo("#/components/schemas/AdminReadingSessionDetail");
        assertThat(actual.at("/paths/~1v2~1admin~1reading-recordings~1{id}~1playback/get/responses/200/content/application~1json/schema/$ref")
                .textValue()).isEqualTo("#/components/schemas/AdminReadingPlayback");
    }

    /** 관리자 422 본문은 pydantic 모양이 곧 계약이라 바이트 그대로 고정한다(키 순서·ctx 유무 포함). */
    @Test
    void validationBodiesStayByteIdentical() throws Exception {
        String[][] cases = {
            {"POST", "/v2/admin/practice-migration?batch=nope",
                    "{\"detail\":[{\"type\":\"int_parsing\",\"loc\":[\"query\",\"batch\"],\"msg\":\"Input should be a valid integer, unable to parse string as an integer\",\"input\":\"nope\"}]}"},
            {"POST", "/v2/admin/practice-migration?batch=0",
                    "{\"detail\":[{\"type\":\"greater_than_equal\",\"loc\":[\"query\",\"batch\"],\"msg\":\"Input should be greater than or equal to 1\",\"input\":\"0\",\"ctx\":{\"ge\":1}}]}"},
            {"POST", "/v2/admin/practice-migration?batch=1001",
                    "{\"detail\":[{\"type\":\"less_than_equal\",\"loc\":[\"query\",\"batch\"],\"msg\":\"Input should be less than or equal to 1000\",\"input\":\"1001\",\"ctx\":{\"le\":1000}}]}"},
            {"GET", "/v2/admin/sessions?limit=nope",
                    "{\"detail\":[{\"type\":\"int_parsing\",\"loc\":[\"query\",\"limit\"],\"msg\":\"Input should be a valid integer, unable to parse string as an integer\",\"input\":\"nope\"}]}"},
            {"GET", "/v2/admin/sessions?limit=0",
                    "{\"detail\":[{\"type\":\"greater_than_equal\",\"loc\":[\"query\",\"limit\"],\"msg\":\"Input should be greater than or equal to 1\",\"input\":\"0\",\"ctx\":{\"ge\":1}}]}"},
            {"GET", "/v2/admin/sessions?limit=51",
                    "{\"detail\":[{\"type\":\"less_than_equal\",\"loc\":[\"query\",\"limit\"],\"msg\":\"Input should be less than or equal to 50\",\"input\":\"51\",\"ctx\":{\"le\":50}}]}"},
            {"GET", "/v2/admin/feedback?include_team=maybe",
                    "{\"detail\":[{\"type\":\"bool_parsing\",\"loc\":[\"query\",\"include_team\"],\"msg\":\"Input should be a valid boolean, unable to interpret input\",\"input\":\"maybe\"}]}"},
            {"GET", "/v2/admin/feedback?exclude_actors=nothex12",
                    "{\"detail\":[{\"type\":\"value_error\",\"loc\":[\"query\",\"exclude_actors\"],\"msg\":\"Value error, exclude_actors must be up to 100 comma-separated 8-digit lowercase hex pseudonyms\",\"input\":\"nothex12\"}]}"},
            {"GET", "/v2/admin/challenge-videos?visibility=friends",
                    "{\"detail\":[{\"type\":\"literal_error\",\"loc\":[\"query\",\"visibility\"],\"msg\":\"Input should be 'all', 'public' or 'private'\",\"input\":\"friends\",\"ctx\":{\"expected\":\"'all', 'public' or 'private'\"}}]}"},
            {"GET", "/v2/admin/reading-sessions?status=done",
                    "{\"detail\":[{\"type\":\"literal_error\",\"loc\":[\"query\",\"status\"],\"msg\":\"Input should be 'all', 'in_progress', 'completed' or 'stopped'\",\"input\":\"done\",\"ctx\":{\"expected\":\"'all', 'in_progress', 'completed' or 'stopped'\"}}]}"},
        };
        for (String[] item : cases) {
            var request = "POST".equals(item[0]) ? post(item[1]) : get(item[1]);
            var response = mvc.perform(request.header("Authorization", "Bearer admin-secret"))
                    .andReturn().getResponse();
            assertThat(response.getStatus()).as(item[1]).isEqualTo(422);
            assertThat(response.getContentAsString(StandardCharsets.UTF_8)).as(item[1]).isEqualTo(item[2]);
        }
    }

    private void assertUnauthorized(String authorization) throws Exception {
        var request = get("/v2/admin/sessions");
        if (authorization != null) {
            request.header("Authorization", authorization);
        }
        RecordingInspector.STATEMENTS.get().clear();
        JsonNode response = json(mvc.perform(request), 401);
        assertThat(response).isEqualTo(mapper.readTree("{\"detail\":\"Unauthorized\"}"));
        assertThat(RecordingInspector.STATEMENTS.get()).isEmpty();
    }

    private JsonNode authorized(String path, int status) throws Exception {
        return json(mvc.perform(get(path).header("Authorization", "Bearer admin-secret")), status);
    }

    private JsonNode json(
            org.springframework.test.web.servlet.ResultActions action,
            int expectedStatus) throws Exception {
        var response = action.andReturn().getResponse();
        assertThat(response.getStatus()).isEqualTo(expectedStatus);
        return mapper.readTree(response.getContentAsString());
    }

    private void insertUser(UUID id, String email, OffsetDateTime createdAt) {
        jdbc.update("""
                INSERT INTO users (id,email,status,created_at,updated_at)
                VALUES (?,?,'active',?,?)
                """, id, email, createdAt, createdAt);
    }

    private UUID insertPractice(
            UUID userId,
            String objectKey,
            String uploadStatus,
            OffsetDateTime createdAt) {
        UUID uploadId = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO upload_intents (
                    id,user_id,status,storage_provider,object_key,mime_type,size_bytes,
                    expires_at,created_at
                ) VALUES (?, ?, ?, 's3', ?, 'video/mp4', 1, ?, ?)
                """, uploadId, userId, uploadStatus, objectKey, createdAt.plusDays(1), createdAt);
        UUID practiceId = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO practice_sessions (
                    id,user_id,upload_intent_id,status,situation,character_context,goal,
                    blockage_kind,sub_branch,created_at,updated_at
                ) VALUES (?, ?, ?, 'analyzed', '상황', '배우', '목표',
                    '분석', '캐릭터 분석', ?, ?)
                """, practiceId, userId, uploadId, createdAt, createdAt);
        return practiceId;
    }

    private UUID insertCoach(UUID practiceId, OffsetDateTime createdAt) {
        UUID coachId = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO coach_sessions (
                    id,practice_session_id,status,conversation_summary,created_at,updated_at
                ) VALUES (?, ?, 'open', '', ?, ?)
                """, coachId, practiceId, createdAt, createdAt);
        return coachId;
    }

    private void insertTurn(UUID coachId, int index, String role, String text) {
        jdbc.update("""
                INSERT INTO coach_turns (session_id,turn_index,role,text,created_at)
                VALUES (?, ?, ?, ?, ?)
                """, coachId, index, role, text, NOW);
    }

    @TestConfiguration
    static class StorageFixture {
        @Bean
        @Primary
        ObjectStorage adminStorage() {
            return new ObjectStorage() {
                @Override public void upload(String objectKey, String mimeType, java.nio.file.Path source) { }

                @Override
                public String presignUpload(
                        String objectKey, String mimeType, long sizeBytes, int expiresInSeconds) {
                    return "unused";
                }

                @Override
                public String presignPlayback(String objectKey, int expiresInSeconds) {
                    if (objectKey.contains("signing.fail")) {
                        throw new RuntimeException("fixture failure");
                    }
                    return "admin:" + objectKey + ":" + expiresInSeconds;
                }

                @Override
                public StoredObjectMetadata head(String objectKey) {
                    return null;
                }

                @Override
                public StoredObjectMetadata downloadToPath(String objectKey, Path destination) {
                    return null;
                }

                @Override
                public void delete(String objectKey) {
                }
            };
        }
    }
}
