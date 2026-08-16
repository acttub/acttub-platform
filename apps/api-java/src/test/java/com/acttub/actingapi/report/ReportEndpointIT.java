package com.acttub.actingapi.report;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import java.nio.file.Path;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.auth.JwtService;
import com.acttub.actingapi.integration.storage.ObjectStorage;
import com.acttub.actingapi.integration.storage.StoredObjectMetadata;
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
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest(properties = "JWT_SECRET=test-secret")
@AutoConfigureMockMvc
@Import(ReportEndpointIT.StorageFixture.class)
class ReportEndpointIT {
    private static final UUID USER =
            UUID.fromString("00000000-0000-4000-8000-000000000501");
    private static final UUID OTHER =
            UUID.fromString("00000000-0000-4000-8000-000000000502");
    private static final OffsetDateTime CREATED_AT =
            OffsetDateTime.of(2026, 8, 8, 2, 3, 4, 567890000, ZoneOffset.UTC);

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        String name = PostgresContainerSupport.createDatabaseName("report_endpoint");
        registry.add("spring.datasource.url", () -> PostgresContainerSupport.jdbcUrlFor(name));
        registry.add("spring.datasource.username", PostgresContainerSupport.POSTGRES::getUsername);
        registry.add("spring.datasource.password", PostgresContainerSupport.POSTGRES::getPassword);
    }

    @Autowired
    MockMvc mvc;

    @Autowired
    JdbcTemplate jdbc;

    @Autowired
    JwtService jwt;

    @Autowired
    ObjectMapper mapper;

    @Autowired
    ReportQueryStore store;

    ReportFixtures fixtures;

    @BeforeEach
    void setUp() {
        jdbc.execute("TRUNCATE TABLE users, consent_documents RESTART IDENTITY CASCADE");
        fixtures = new ReportFixtures(jdbc);
        insertUser(USER);
        insertUser(OTHER);
    }

    @Test
    void listAndDetailPreserveOwnershipVisibilityOrderingAndResponseShape() throws Exception {
        UUID first = insertPractice(USER, "first.mp4", null);
        UUID second = insertPractice(USER, "second.mp4", null);
        UUID hidden = insertPractice(USER, "hidden.mp4", CREATED_AT);
        UUID other = insertPractice(OTHER, "other.mp4", null);
        insertReport(first, "analysis", analysisReport("첫 리포트"), CREATED_AT);
        insertReport(second, "expression", expressionReport("두 번째"), CREATED_AT.plusSeconds(1));
        insertReport(hidden, "analysis", analysisReport("숨긴 리포트"), CREATED_AT.plusSeconds(2));
        insertReport(other, "analysis", analysisReport("남의 리포트"), CREATED_AT.plusSeconds(3));

        JsonNode history = body(get("/v2/reports")
                .header("Authorization", bearer(USER)));
        assertThat(history.path("count").intValue()).isEqualTo(2);
        assertThat(history.at("/reports/0/practice_session_id").textValue())
                .isEqualTo(first.toString());
        assertThat(history.at("/reports/0/title").textValue()).isEqualTo("첫 리포트");
        assertThat(history.at("/reports/0/created_at").textValue())
                .isEqualTo("2026-08-08T02:03:04.567890Z");
        assertThat(history.at("/reports/1/practice_session_id").textValue())
                .isEqualTo(second.toString());

        JsonNode detail = body(get("/v2/reports/{id}", first)
                .header("Authorization", bearer(USER)));
        assertThat(detail.fieldNames()).toIterable()
                .containsExactly("practice_session_id", "created_at", "report", "playback_url");
        assertThat(detail.path("report")).isEqualTo(analysisReport("첫 리포트"));
        assertThat(detail.path("playback_url").textValue())
                .isEqualTo("playback:first.mp4:900");

        assertThat(store.hasReportForPracticeSession(first)).isTrue();
        assertThat(store.hasReportForPracticeSession(UUID.randomUUID())).isFalse();
        assertMissing(first, OTHER);
        assertMissing(UUID.randomUUID(), USER);
        assertMissing(hidden, USER);
    }

    @Test
    void postRouteIsOpenAndItsOpenApiMatchesCommittedPythonSpec() throws Exception {
        var response = mvc.perform(post("/v2/reports")
                        .header("Authorization", bearer(USER)))
                .andReturn().getResponse();
        assertThat(response.getStatus()).isEqualTo(422);

        JsonNode openapi = body(get("/v3/api-docs"));
        JsonNode expected = mapper.readTree(Path.of("../api/spec/openapi.json").toFile());
        assertThat(openapi.at("/paths/~1v2~1reports/post"))
                .isEqualTo(expected.at("/paths/~1v2~1reports/post"));
        assertThat(openapi.at("/paths/~1v2~1reports/get").isMissingNode()).isFalse();
        assertThat(openapi.at("/paths/~1v2~1reports~1{practice_session_id}/get").isMissingNode())
                .isFalse();
        for (String component : List.of("ReportReq", "BlockedReport")) {
            assertThat(normalize(openapi.at("/components/schemas/" + component)))
                    .as(component)
                    .isEqualTo(normalize(expected.at("/components/schemas/" + component)));
        }
    }

    @Test
    void reportGetOpenApiSliceMatchesCommittedPythonSpec() throws Exception {
        JsonNode actual = body(get("/v3/api-docs"));
        JsonNode expected = mapper.readTree(Path.of("../api/spec/openapi.json").toFile());
        assertThat(actual.at("/paths/~1v2~1reports/get"))
                .isEqualTo(expected.at("/paths/~1v2~1reports/get"));
        assertThat(actual.at("/paths/~1v2~1reports~1{practice_session_id}/get"))
                .isEqualTo(expected.at("/paths/~1v2~1reports~1{practice_session_id}/get"));
        for (String component : List.of(
                "ReportRecord",
                "ReportHistoryResponse",
                "ReportDetailResponse",
                "AnalysisReport",
                "AnalysisNextTake",
                "ExpressionReport",
                "EffectiveExperiment",
                "ActorTraining",
                "SourceHandoffIds")) {
            assertThat(normalize(actual.at("/components/schemas/" + component)))
                    .as(component)
                    .isEqualTo(normalize(expected.at("/components/schemas/" + component)));
        }
    }

    private void assertMissing(UUID practiceSessionId, UUID userId) throws Exception {
        var response = mvc.perform(get("/v2/reports/{id}", practiceSessionId)
                        .header("Authorization", bearer(userId)))
                .andReturn().getResponse();
        assertThat(response.getStatus()).isEqualTo(404);
        assertThat(mapper.readTree(response.getContentAsString()))
                .isEqualTo(mapper.readTree("{\"detail\":\"report_not_found\"}"));
    }

    private UUID insertPractice(UUID userId, String objectKey, OffsetDateTime hiddenAt) {
        UUID uploadId = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO upload_intents (
                    id,user_id,status,storage_provider,object_key,mime_type,size_bytes,expires_at
                ) VALUES (?,?,'finalized'::upload_status_t,'s3',?,'video/mp4',1,?)
                """, uploadId, userId, objectKey, CREATED_AT.plusDays(1));
        UUID practiceId = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO practice_sessions (
                    id,user_id,upload_intent_id,status,situation,character_context,goal,
                    blockage_kind,sub_branch,hidden_at
                ) VALUES (?, ?, ?, 'analyzed'::practice_status_t, '상황', '인물', '목표',
                    '분석', '캐릭터 분석', ?)
                """, practiceId, userId, uploadId, hiddenAt);
        return practiceId;
    }

    private void insertReport(
            UUID practiceId,
            String reportType,
            JsonNode report,
            OffsetDateTime createdAt) {
        UUID sourceHandoffId = fixtures.insertHandoff(practiceId);
        jdbc.update("""
                INSERT INTO practice_reports (
                    id,practice_session_id,report_type,report_json,source_handoff_id,created_at
                ) VALUES (?, ?, ?, ?::jsonb, ?, ?)
                """,
                UUID.randomUUID(),
                practiceId,
                reportType,
                report.toString(),
                sourceHandoffId,
                createdAt);
    }

    private void insertUser(UUID id) {
        jdbc.update("""
                INSERT INTO users (id,email,status)
                VALUES (?,?,'active'::user_status_t)
                """, id, id + "@example.test");
    }

    private JsonNode analysisReport(String title) throws Exception {
        return mapper.readTree("""
                {
                  "report_type":"analysis",
                  "title":"%s",
                  "actor_discovery":"발견",
                  "line_meaning":"의미",
                  "timing_reason":"타이밍",
                  "target_effect":"효과",
                  "next_take":{"direction":"방향","tested":false},
                  "acting_caution":"주의",
                  "evidence":["근거"],
                  "uncertainties":[],
                  "source_handoff_id":"handoff-analysis"
                }
                """.formatted(title));
    }

    private JsonNode expressionReport(String title) throws Exception {
        return mapper.readTree("""
                {
                  "report_type":"expression",
                  "title":"%s",
                  "blocked_point":"막힘",
                  "expression_core":"핵심",
                  "line_meaning":"의미",
                  "timing_reason":"타이밍",
                  "playable_action":"행동",
                  "effective_experiment":{"instruction":"실험","tested":true},
                  "observed_change":"변화",
                  "next_take":"다음",
                  "acting_trap":"함정",
                  "actor_training":{"title":"훈련","purpose":"목적","duration_minutes":3,
                    "steps":["하나"],"focus":"집중","success_check":"확인","tested":false},
                  "evidence":[],"actor_words":[],"uncertainties":[],
                  "source_handoff_ids":{"analysis":null,"expression":"handoff-expression"}
                }
                """.formatted(title));
    }

    private JsonNode body(org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder request)
            throws Exception {
        var response = mvc.perform(request).andReturn().getResponse();
        assertThat(response.getStatus()).isEqualTo(200);
        return mapper.readTree(response.getContentAsString());
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
            node.forEach(ReportEndpointIT::normalizeRequired);
        } else if (node.isArray()) {
            node.forEach(ReportEndpointIT::normalizeRequired);
        }
    }

    @TestConfiguration
    static class StorageFixture {
        @Bean
        @Primary
        ObjectStorage reportStorage() {
            return new ObjectStorage() {
                @Override
                public String presignUpload(
                        String objectKey, String mimeType, long sizeBytes, int expiresInSeconds) {
                    return "unused";
                }

                @Override
                public String presignPlayback(String objectKey, int expiresInSeconds) {
                    return "playback:" + objectKey + ":" + expiresInSeconds;
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
