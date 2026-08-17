package com.acttub.actingapi.feature.coach.adapter.web;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import java.nio.file.Path;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Deque;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.coach.adapter.db.CoachStorageFixtures;
import com.acttub.actingapi.feature.coach.domain.CoachTurnSnapshot;
import com.acttub.actingapi.feature.auth.app.JwtService;
import com.acttub.actingapi.integration.llm.GeneratedText;
import com.acttub.actingapi.integration.llm.TextGenerator;
import com.acttub.actingapi.integration.llm.TokenUsage;
import com.acttub.actingapi.support.PostgresContainerSupport;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.BeforeEach;
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
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest(properties = "JWT_SECRET=test-secret")
@AutoConfigureMockMvc
@Import(CoachReportEndpointIT.GeneratorFixture.class)
class CoachReportEndpointIT {

    private static final OffsetDateTime CREATED_AT =
            CoachStorageFixtures.NOW.atOffset(ZoneOffset.UTC);

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        String name = PostgresContainerSupport.createDatabaseName("coach_report_endpoint");
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
    RecordingGenerator generator;

    CoachStorageFixtures fixtures;

    @BeforeEach
    void setUp() {
        jdbc.execute("TRUNCATE TABLE users, consent_documents RESTART IDENTITY CASCADE");
        fixtures = new CoachStorageFixtures(jdbc);
        generator.reset();
    }

    @Test
    void resumeReturnsTheOpenSessionWithoutCreatingAnOperationOrCallingLlm() throws Exception {
        UUID userId = fixtures.insertUser();
        CoachStorageFixtures.Practice practice = fixtures.insertPractice(userId);
        UUID summaryId = fixtures.insertSummary(practice.id());
        useValidObservationPack(practice.id());
        UUID sessionId = UUID.randomUUID();
        fixtures.insertCoachSession(sessionId, practice.id(), summaryId, "open", CREATED_AT, List.of(
                new CoachTurnSnapshot("actor", "배우 말"),
                new CoachTurnSnapshot("ai", "저장된 질문")));

        JsonNode response = successful(post("/v2/coach/start")
                .contentType(MediaType.APPLICATION_JSON)
                .header("Authorization", bearer(userId))
                .header("X-Request-Id", UUID.randomUUID())
                .content("""
                        {"practice_session_id":"%s"}
                        """.formatted(practice.id())));

        assertThat(response.path("session_id").textValue()).isEqualTo(sessionId.toString());
        assertThat(response.path("message").textValue()).isEqualTo("저장된 질문");
        assertThat(response.path("turns")).hasSize(2);
        assertThat(generator.callCount()).isZero();
        assertThat(jdbc.queryForObject(
                "SELECT count(*) FROM external_operations", Long.class)).isZero();
    }

    @Test
    void existingReportBlocksResumeAndBypassesBothCreateAndConfirmGeneration() throws Exception {
        UUID userId = fixtures.insertUser();
        CoachStorageFixtures.Practice practice = fixtures.insertPractice(userId);
        UUID summaryId = fixtures.insertSummary(practice.id());
        UUID sessionId = UUID.randomUUID();
        fixtures.insertCoachSession(sessionId, practice.id(), summaryId, "open", CREATED_AT, List.of());
        UUID handoffId = fixtures.insertHandoff(sessionId, practice.id(), CREATED_AT);
        JsonNode report = analysisReport(handoffId);
        insertReport(practice.id(), handoffId, report);

        var resume = mvc.perform(post("/v2/coach/start")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header("Authorization", bearer(userId))
                        .header("X-Request-Id", UUID.randomUUID())
                        .content("""
                                {"practice_session_id":"%s"}
                                """.formatted(practice.id())))
                .andReturn().getResponse();
        assertThat(resume.getStatus()).isEqualTo(409);
        assertThat(mapper.readTree(resume.getContentAsString()).path("detail").textValue())
                .isEqualTo("report already exists for practice session");

        JsonNode created = successful(post("/v2/reports")
                .contentType(MediaType.APPLICATION_JSON)
                .header("Authorization", bearer(userId))
                .header("X-Request-Id", UUID.randomUUID())
                .content("""
                        {"session_id":"%s"}
                        """.formatted(sessionId)));
        assertThat(created).isEqualTo(report);

        JsonNode confirmed = successful(post("/v2/coach/confirm")
                .contentType(MediaType.APPLICATION_JSON)
                .header("Authorization", bearer(userId))
                .header("X-Request-Id", UUID.randomUUID())
                .content("""
                        {"coach_session_id":"%s","confirmed":true}
                        """.formatted(sessionId)));
        assertThat(confirmed.path("report")).isEqualTo(report);
        assertThat(generator.callCount()).isZero();
    }

    @Test
    void confirmParseFailureLeavesConfirmationAndClosedSessionCommitted() throws Exception {
        UUID userId = fixtures.insertUser();
        CoachStorageFixtures.Practice practice = fixtures.insertPractice(userId);
        UUID summaryId = fixtures.insertSummary(practice.id());
        useValidObservationPack(practice.id());
        UUID sessionId = UUID.randomUUID();
        fixtures.insertCoachSession(sessionId, practice.id(), summaryId, "open", CREATED_AT, List.of());
        UUID handoffId = fixtures.insertHandoff(sessionId, practice.id(), CREATED_AT);
        generator.enqueue("not-json");
        UUID requestId = UUID.randomUUID();

        var failed = mvc.perform(post("/v2/coach/confirm")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header("Authorization", bearer(userId))
                        .header("X-Request-Id", requestId)
                        .content("""
                                {"coach_session_id":"%s","confirmed":true}
                                """.formatted(sessionId)))
                .andReturn().getResponse();

        assertThat(failed.getStatus()).isEqualTo(502);
        assertThat(fixtures.coachStatus(sessionId)).isEqualTo("closed");
        assertThat(jdbc.queryForObject("""
                SELECT confirmed FROM handoff_confirmations
                WHERE coaching_handoff_id = ?
                """, Boolean.class, handoffId)).isTrue();
        assertThat(jdbc.queryForMap("""
                SELECT status::text AS status, error_code
                FROM external_operations WHERE request_id = ?
                """, requestId))
                .containsEntry("status", "failed")
                .containsEntry("error_code", "report_parse_error");

        var reply = mvc.perform(post("/v2/coach/reply")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header("Authorization", bearer(userId))
                        .header("X-Request-Id", UUID.randomUUID())
                        .content("""
                                {"session_id":"%s","text":"계속할게"}
                                """.formatted(sessionId)))
                .andReturn().getResponse();
        assertThat(reply.getStatus()).isEqualTo(409);
        assertThat(mapper.readTree(reply.getContentAsString()).path("detail").textValue())
                .isEqualTo("session is closed");
        assertThat(generator.callCount()).isEqualTo(1);
    }

    @Test
    void fourOpenedRoutesAndTheirComponentsMatchCommittedOpenApi() throws Exception {
        JsonNode actual = successful(get("/v3/api-docs"));
        JsonNode expected = mapper.readTree(Path.of("../api/spec/openapi.json").toFile());
        for (String path : List.of(
                "/v2/coach/start", "/v2/coach/reply", "/v2/coach/confirm", "/v2/reports")) {
            assertThat(actual.path("paths").path(path).path("post"))
                    .as(path)
                    .isEqualTo(expected.path("paths").path(path).path("post"));
        }
        for (String component : List.of(
                "CoachStartReq", "CoachReplyReq", "CoachConfirmReq",
                "PublicHandoff", "PublicCoachTurn", "CoachTurnResponse",
                "CoachConfirmResponse", "ReportReq", "BlockedReport")) {
            assertThat(normalize(actual.at("/components/schemas/" + component)))
                    .as(component)
                    .isEqualTo(normalize(expected.at("/components/schemas/" + component)));
        }
    }

    private JsonNode successful(
            org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder request)
            throws Exception {
        var response = mvc.perform(request).andReturn().getResponse();
        assertThat(response.getStatus()).isEqualTo(200);
        return mapper.readTree(response.getContentAsString());
    }

    private void insertReport(UUID practiceId, UUID handoffId, JsonNode report) {
        jdbc.update("""
                INSERT INTO practice_reports (
                    id, practice_session_id, report_type, report_json,
                    source_handoff_id, created_at
                ) VALUES (?, ?, 'analysis', ?::jsonb, ?, ?)
                """,
                UUID.randomUUID(),
                practiceId,
                report.toString(),
                handoffId,
                CREATED_AT);
    }

    private void useValidObservationPack(UUID practiceId) {
        jdbc.update("""
                UPDATE summaries
                SET observations_json = ?::jsonb, uncertainties_json = '[]'::jsonb
                WHERE session_id = ?
                """,
                "[{\"start_ms\":0,\"end_ms\":100,\"label\":\"멈춘다\",\"confidence\":0.9}]",
                practiceId);
    }

    private JsonNode analysisReport(UUID handoffId) throws Exception {
        return mapper.readTree("""
                {
                  "report_type":"analysis","title":"기존 리포트",
                  "actor_discovery":"발견","line_meaning":"의미",
                  "timing_reason":"타이밍","target_effect":"효과",
                  "next_take":{"direction":"방향","tested":false},
                  "acting_caution":"주의","evidence":[],"uncertainties":[],
                  "source_handoff_id":"%s"
                }
                """.formatted(handoffId));
    }

    private String bearer(UUID userId) {
        return "Bearer " + jwt.issueAccessToken(userId).value();
    }

    private static JsonNode normalize(JsonNode node) {
        JsonNode copy = node.deepCopy();
        normalizeRequired(copy);
        return copy;
    }

    private static void normalizeRequired(JsonNode node) {
        if (node.isObject()) {
            if (node.has("required") && node.path("required").isArray()) {
                List<String> values = new ArrayList<>();
                node.path("required").forEach(value -> values.add(value.textValue()));
                Collections.sort(values);
                ArrayNode sorted = ((ObjectNode) node).arrayNode();
                values.forEach(sorted::add);
                ((ObjectNode) node).set("required", sorted);
            }
            node.forEach(CoachReportEndpointIT::normalizeRequired);
        } else if (node.isArray()) {
            node.forEach(CoachReportEndpointIT::normalizeRequired);
        }
    }

    @TestConfiguration
    static class GeneratorFixture {
        @Bean
        @Primary
        RecordingGenerator recordingGenerator() {
            return new RecordingGenerator();
        }
    }

    static final class RecordingGenerator implements TextGenerator {
        private final Deque<String> responses = new ArrayDeque<>();
        private int calls;

        @Override
        public synchronized GeneratedText generate(String instructions, String input) {
            calls++;
            if (responses.isEmpty()) {
                throw new AssertionError("unexpected LLM call");
            }
            return new GeneratedText(responses.removeFirst(), new TokenUsage(0, 0, 0));
        }

        synchronized void enqueue(String response) {
            responses.addLast(response);
        }

        synchronized int callCount() {
            return calls;
        }

        synchronized void reset() {
            responses.clear();
            calls = 0;
        }
    }
}
