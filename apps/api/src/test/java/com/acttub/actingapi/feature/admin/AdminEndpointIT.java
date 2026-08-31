package com.acttub.actingapi.feature.admin;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;

import java.nio.file.Path;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.HashSet;
import java.util.Set;
import java.util.UUID;

import com.acttub.actingapi.integration.storage.ObjectStorage;
import com.acttub.actingapi.integration.storage.StoredObjectMetadata;
import com.acttub.actingapi.support.PostgresContainerSupport;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
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
    "ADMIN_OPS_EXCLUDE_EMAILS=team@acttub.com"
})
@AutoConfigureMockMvc
@Import(AdminEndpointIT.StorageFixture.class)
class AdminEndpointIT {
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
        assertThat(added).containsExactly("/v2/admin/sessions");
        assertThat(actual.at("/paths/~1v2~1admin~1sessions/get/parameters/0/schema/type")
                .textValue()).isEqualTo("integer");
        assertThat(actual.at("/paths/~1v2~1admin~1sessions/get/parameters/0/schema/default")
                .intValue()).isEqualTo(20);
    }

    private void assertUnauthorized(String authorization) throws Exception {
        var request = get("/v2/admin/sessions");
        if (authorization != null) {
            request.header("Authorization", authorization);
        }
        JsonNode response = json(mvc.perform(request), 401);
        assertThat(response).isEqualTo(mapper.readTree("{\"detail\":\"Unauthorized\"}"));
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
                @Override
                public String presignUpload(
                        String objectKey, String mimeType, long sizeBytes, int expiresInSeconds) {
                    return "unused";
                }

                @Override
                public String presignPlayback(String objectKey, int expiresInSeconds) {
                    if (objectKey.endsWith(".fail")) {
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
