package com.acttub.actingapi.practice;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.UUID;

import com.acttub.actingapi.auth.JwtService;
import com.acttub.actingapi.operation.ExternalOperationClaimer;
import com.acttub.actingapi.storage.ObjectStorage;
import com.acttub.actingapi.storage.StoredObjectMetadata;
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
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

@SpringBootTest(properties = "JWT_SECRET=test-secret")
@AutoConfigureMockMvc
@Import(PracticeSessionEndpointIT.StorageFixture.class)
class PracticeSessionEndpointIT {
    private static final UUID USER_ID =
            UUID.fromString("00000000-0000-4000-8000-000000000301");
    private static final UUID OTHER_USER_ID =
            UUID.fromString("00000000-0000-4000-8000-000000000302");
    private static final OffsetDateTime NOW =
            OffsetDateTime.of(2026, 8, 8, 1, 2, 3, 456789000, ZoneOffset.UTC);

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        String name = PostgresContainerSupport.createDatabaseName("practice_endpoint");
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
    ExternalOperationClaimer operations;

    @BeforeEach
    void setUp() {
        jdbc.execute("TRUNCATE TABLE users,consent_documents RESTART IDENTITY CASCADE");
        insertUser(USER_ID);
        insertUser(OTHER_USER_ID);
    }

    @Test
    void createReplayListStatusDetailAndDeletePreserveObservableShapes() throws Exception {
        UUID uploadId = insertUpload(USER_ID, "finalized", "users/owner/video.mp4");
        UUID requestId = UUID.randomUUID();

        MvcResult created = create(uploadId, requestId, validBody(uploadId));
        assertThat(created.getResponse().getStatus()).isEqualTo(202);
        assertThat(created.getResponse().getHeader("X-Request-Id"))
                .isEqualTo(requestId.toString());
        UUID sessionId = UUID.fromString(json(created).path("session_id").textValue());

        MvcResult replay = create(uploadId, requestId, validBody(uploadId));
        assertThat(replay.getResponse().getStatus()).isEqualTo(202);
        assertThat(replay.getResponse().getContentAsByteArray())
                .isEqualTo(created.getResponse().getContentAsByteArray());
        assertThat(replay.getResponse().getHeader("X-Request-Id"))
                .isEqualTo(requestId.toString());

        JsonNode listed = json(mvc.perform(get("/v2/practice-sessions")
                        .header("Authorization", bearer(USER_ID)))
                .andReturn());
        assertThat(listed.path("sessions").size()).isEqualTo(1);
        assertThat(listed.at("/sessions/0/blockage_detail").isNull()).isTrue();

        JsonNode status = json(mvc.perform(get("/v2/practice-sessions/{id}/status", sessionId)
                        .header("Authorization", bearer(USER_ID)))
                .andReturn());
        assertThat(status).isEqualTo(mapper.readTree(
                "{\"status\":\"analyzing\",\"error_code\":null}"));

        JsonNode pendingDetail = detail(sessionId);
        assertThat(pendingDetail.has("summary")).isFalse();
        assertThat(pendingDetail.has("error_code")).isFalse();
        assertThat(pendingDetail.path("blockage_detail").isNull()).isTrue();
        assertThat(pendingDetail.path("playback_url").textValue())
                .contains("users/owner/video.mp4");

        UUID summaryId = insertSummary(sessionId);
        jdbc.update("UPDATE practice_sessions SET status='analyzed'::practice_status_t WHERE id=?",
                sessionId);
        JsonNode analyzedDetail = detail(sessionId);
        assertThat(analyzedDetail.path("summary").path("summary_id").textValue())
                .isEqualTo(summaryId.toString());
        assertThat(analyzedDetail.path("summary").at("/observations/0/label").textValue())
                .isEqualTo("한국어 관찰");
        assertThat(analyzedDetail.has("error_code")).isFalse();

        jdbc.update("UPDATE practice_sessions SET status='failed'::practice_status_t WHERE id=?",
                sessionId);
        jdbc.update("""
                UPDATE external_operations
                SET status='failed'::operation_status_t,error_code='gemini_timeout'
                WHERE session_id=?
                """, sessionId);
        JsonNode failedDetail = detail(sessionId);
        assertThat(failedDetail.has("summary")).isFalse();
        assertThat(failedDetail.path("error_code").textValue()).isEqualTo("gemini_timeout");

        var deleted = mvc.perform(delete("/v2/practice-sessions/{id}", sessionId)
                        .header("Authorization", bearer(USER_ID)))
                .andReturn().getResponse();
        assertThat(deleted.getStatus()).isEqualTo(204);
        assertThat(deleted.getContentAsByteArray()).isEmpty();
        assertThat(mvc.perform(get("/v2/practice-sessions/{id}", sessionId)
                        .header("Authorization", bearer(USER_ID)))
                .andReturn().getResponse().getStatus()).isEqualTo(404);
    }

    @Test
    void createReplaysEveryOperationTransitionAndCanonicalStoredPayload() throws Exception {
        UUID uploadId = insertUpload(USER_ID, "finalized", "video.mp4");
        UUID requestId = UUID.randomUUID();
        MvcResult first = create(uploadId, requestId, validBody(uploadId));
        UUID sessionId = UUID.fromString(json(first).path("session_id").textValue());

        jdbc.update("""
                UPDATE external_operations
                SET status='running'::operation_status_t,lease_token=?
                WHERE request_id=?
                """, UUID.randomUUID(), requestId);
        MvcResult running = create(uploadId, requestId, validBody(uploadId));
        assertThat(running.getResponse().getStatus()).isEqualTo(202);
        assertThat(running.getResponse().getContentAsByteArray())
                .isEqualTo(first.getResponse().getContentAsByteArray());

        UUID summaryId = UUID.randomUUID();
        jdbc.update("""
                UPDATE external_operations
                SET status='succeeded'::operation_status_t,
                    response_payload=?::jsonb
                WHERE request_id=?
                """, """
                {"summary_id":"%s","status":"analyzed","session_id":"%s",
                 "한국어":{"나":2,"가":1}}
                """.formatted(summaryId, sessionId), requestId);
        MvcResult succeeded = create(uploadId, requestId, validBody(uploadId));
        assertThat(succeeded.getResponse().getStatus()).isEqualTo(200);
        assertThat(new String(
                succeeded.getResponse().getContentAsByteArray(),
                java.nio.charset.StandardCharsets.UTF_8))
                // 괄호가 없으면 formatted 가 뒤쪽 리터럴에만 붙어 첫 %s 가 치환되지 않는다.
                .isEqualTo(("{\"session_id\":\"%s\",\"status\":\"analyzed\","
                        + "\"summary_id\":\"%s\",\"한국어\":{\"가\":1,\"나\":2}}")
                                .formatted(sessionId, summaryId));
        MvcResult succeededAgain = create(uploadId, requestId, validBody(uploadId));
        assertThat(succeededAgain.getResponse().getContentAsByteArray())
                .isEqualTo(succeeded.getResponse().getContentAsByteArray());

        MvcResult mismatch = create(uploadId, requestId,
                validBody(uploadId).replace("상황", "다른 상황"));
        assertError(mismatch, 422, "request_fingerprint_mismatch");

        jdbc.update("""
                UPDATE external_operations
                SET status='failed'::operation_status_t,attempt_count=3,
                    lease_token=NULL,error_code='gemini_timeout'
                WHERE request_id=?
                """, requestId);
        jdbc.update("UPDATE practice_sessions SET status='failed'::practice_status_t WHERE id=?",
                sessionId);
        assertError(create(uploadId, requestId, validBody(uploadId)),
                409, "analysis_retry_exhausted");
    }

    @Test
    void failedReplayResumesOperationAndSessionAtomically() throws Exception {
        UUID uploadId = insertUpload(USER_ID, "finalized", "video.mp4");
        UUID requestId = UUID.randomUUID();
        UUID sessionId = UUID.fromString(json(create(
                uploadId, requestId, validBody(uploadId))).path("session_id").textValue());
        jdbc.update("""
                UPDATE external_operations
                SET status='failed'::operation_status_t,attempt_count=1,
                    lease_token=NULL,error_code='gemini_timeout',response_payload='{}'::jsonb
                WHERE request_id=?
                """, requestId);
        jdbc.update("UPDATE practice_sessions SET status='failed'::practice_status_t WHERE id=?",
                sessionId);

        MvcResult resumed = create(uploadId, requestId, validBody(uploadId));

        assertThat(resumed.getResponse().getStatus()).isEqualTo(202);
        assertThat(jdbc.queryForObject(
                "SELECT status::text FROM external_operations WHERE request_id=?",
                String.class, requestId)).isEqualTo("pending");
        assertThat(jdbc.queryForObject(
                """
                SELECT response_payload = 'null'::jsonb
                FROM external_operations
                WHERE request_id=?
                """,
                Boolean.class, requestId)).isTrue();
        assertThat(jdbc.queryForObject(
                "SELECT status::text FROM practice_sessions WHERE id=?",
                String.class, sessionId)).isEqualTo("analyzing");
    }

    @Test
    void exhaustedWorkerRetriesSweepSessionAndReplayAsAnalysisRetryExhausted()
            throws Exception {
        UUID uploadId = insertUpload(USER_ID, "finalized", "video.mp4");
        UUID requestId = UUID.randomUUID();
        MvcResult created = create(uploadId, requestId, validBody(uploadId));
        UUID operationId = jdbc.queryForObject(
                "SELECT id FROM external_operations WHERE request_id=?",
                UUID.class,
                requestId);
        Instant base = NOW.toInstant();

        for (int attempt = 1;
                attempt <= ExternalOperationClaimer.MAX_EXTERNAL_OPERATION_ATTEMPTS;
                attempt++) {
            UUID leaseToken = UUID.randomUUID();
            Instant attemptAt = base.plusSeconds(attempt);
            assertThat(operations.claimNext(
                    "analyze", leaseToken, Duration.ofSeconds(1800), attemptAt))
                    .isEqualTo(operationId);
            assertThat(operations.release(
                    operationId, leaseToken, attemptAt.plusMillis(1))).isTrue();
        }

        assertThat(operations.sweepMaxAttempts(base.plusSeconds(3600))).isEqualTo(1);
        UUID sessionId = UUID.fromString(json(created).path("session_id").textValue());
        JsonNode status = json(mvc.perform(get("/v2/practice-sessions/{id}/status", sessionId)
                        .header("Authorization", bearer(USER_ID)))
                .andReturn());
        assertThat(status).isEqualTo(mapper.readTree(
                "{\"status\":\"failed\",\"error_code\":\"max_attempts_exceeded\"}"));
        assertError(create(uploadId, requestId, validBody(uploadId)),
                409, "analysis_retry_exhausted");
    }

    @Test
    void reanalysisHasTheSameIdempotentContract() throws Exception {
        UUID uploadId = insertUpload(USER_ID, "finalized", "video.mp4");
        UUID sessionId = UUID.fromString(json(create(
                uploadId, UUID.randomUUID(), validBody(uploadId)))
                .path("session_id").textValue());

        assertError(mvc.perform(post("/v2/practice-sessions/{id}/analyze", sessionId)
                        .header("Authorization", bearer(USER_ID)))
                .andReturn(), 409, "session_is_not_failed");
        assertError(mvc.perform(post("/v2/practice-sessions/{id}/analyze", UUID.randomUUID())
                        .header("Authorization", bearer(USER_ID)))
                .andReturn(), 404, "practice_session_not_found");

        jdbc.update("UPDATE practice_sessions SET status='failed'::practice_status_t WHERE id=?",
                sessionId);
        UUID requestId = UUID.randomUUID();
        MvcResult accepted = reanalyze(sessionId, requestId);
        MvcResult replay = reanalyze(sessionId, requestId);
        assertThat(accepted.getResponse().getStatus()).isEqualTo(202);
        assertThat(replay.getResponse().getContentAsByteArray())
                .isEqualTo(accepted.getResponse().getContentAsByteArray());
        assertThat(replay.getResponse().getHeader("X-Request-Id"))
                .isEqualTo(requestId.toString());

        UUID summaryId = UUID.randomUUID();
        jdbc.update("""
                UPDATE external_operations
                SET status='succeeded'::operation_status_t,
                    response_payload=?::jsonb
                WHERE request_id=?
                """, """
                {"summary_id":"%s","status":"analyzed","session_id":"%s"}
                """.formatted(summaryId, sessionId), requestId);
        MvcResult succeeded = reanalyze(sessionId, requestId);
        MvcResult succeededReplay = reanalyze(sessionId, requestId);
        assertThat(succeeded.getResponse().getStatus()).isEqualTo(200);
        assertThat(succeededReplay.getResponse().getContentAsByteArray())
                .isEqualTo(succeeded.getResponse().getContentAsByteArray());

        UUID otherUpload = insertUpload(USER_ID, "finalized", "other.mp4");
        UUID otherSession = UUID.fromString(json(create(
                otherUpload, UUID.randomUUID(), validBody(otherUpload)))
                .path("session_id").textValue());
        jdbc.update("UPDATE practice_sessions SET status='failed'::practice_status_t WHERE id=?",
                otherSession);
        assertError(reanalyze(otherSession, requestId),
                422, "request_fingerprint_mismatch");
    }

    @Test
    void crossFieldErrorEchoesWholeBodyAndUnknownKeysAreRejected() throws Exception {
        UUID uploadId = insertUpload(USER_ID, "finalized", "video.mp4");
        String invalidPair = validBody(uploadId).replace("대사 분석", "감정");
        MvcResult crossField = create(uploadId, UUID.randomUUID(), invalidPair);
        assertThat(crossField.getResponse().getStatus()).isEqualTo(422);
        JsonNode detail = json(crossField).path("detail").get(0);
        assertThat(detail.path("type").textValue()).isEqualTo("value_error");
        assertThat(detail.path("loc")).isEqualTo(mapper.readTree("[\"body\"]"));
        assertThat(detail.path("msg").textValue())
                .isEqualTo("Value error, sub_branch does not match blockage_kind");
        assertThat(detail.path("input")).isEqualTo(mapper.readTree(invalidPair));
        // ctx.error 는 사유 문자열이 아니라 빈 객체다 — pydantic 의 ValueError 객체를 FastAPI 의
        // jsonable_encoder 가 인코딩하지 못해 {} 가 나간다(실측). 사유는 msg 에만 남는다.
        assertThat(detail.path("ctx")).isEqualTo(mapper.readTree("{\"error\":{}}"));

        MvcResult unknown = create(uploadId, UUID.randomUUID(),
                validBody(uploadId).replace("}", ",\"surprise\":true}"));
        assertThat(unknown.getResponse().getStatus()).isEqualTo(422);
        assertThat(json(unknown).at("/detail/0/type").textValue())
                .isEqualTo("extra_forbidden");

        assertThat(create(uploadId, UUID.randomUUID(), validBody(uploadId))
                .getResponse().getStatus()).isEqualTo(202);
    }

    @Test
    void missingForeignAndUnfinalizedResourcesUseRouterSpecificErrors() throws Exception {
        UUID foreignUpload = insertUpload(OTHER_USER_ID, "finalized", "foreign.mp4");
        assertError(create(foreignUpload, UUID.randomUUID(), validBody(foreignUpload)),
                404, "upload_intent_not_found");

        UUID pendingUpload = insertUpload(USER_ID, "pending", "pending.mp4");
        assertError(create(pendingUpload, UUID.randomUUID(), validBody(pendingUpload)),
                409, "upload_intent_not_finalized");
    }

    @Test
    void requestIdIsGeneratedOrRejectedBeforeResourceLookup() throws Exception {
        UUID missingUpload = UUID.randomUUID();
        MvcResult generated = mvc.perform(post("/v2/practice-sessions")
                        .header("Authorization", bearer(USER_ID))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(validBody(missingUpload)))
                .andReturn();
        assertThat(generated.getResponse().getStatus()).isEqualTo(404);

        MvcResult invalid = mvc.perform(post("/v2/practice-sessions")
                        .header("Authorization", bearer(USER_ID))
                        .header("X-Request-Id", "not-a-uuid")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(validBody(missingUpload)))
                .andReturn();
        assertError(invalid, 422, "invalid X-Request-Id");

        UUID uploadId = insertUpload(USER_ID, "finalized", "generated.mp4");
        MvcResult accepted = mvc.perform(post("/v2/practice-sessions")
                        .header("Authorization", bearer(USER_ID))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(validBody(uploadId)))
                .andReturn();
        assertThat(accepted.getResponse().getStatus()).isEqualTo(202);
        assertThat(UUID.fromString(accepted.getResponse().getHeader("X-Request-Id")))
                .isNotNull();
    }

    private MvcResult create(UUID uploadId, UUID requestId, String body) throws Exception {
        return mvc.perform(post("/v2/practice-sessions")
                        .header("Authorization", bearer(USER_ID))
                        .header("X-Request-Id", requestId)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andReturn();
    }

    private MvcResult reanalyze(UUID sessionId, UUID requestId) throws Exception {
        return mvc.perform(post("/v2/practice-sessions/{id}/analyze", sessionId)
                        .header("Authorization", bearer(USER_ID))
                        .header("X-Request-Id", requestId))
                .andReturn();
    }

    private JsonNode detail(UUID sessionId) throws Exception {
        return json(mvc.perform(get("/v2/practice-sessions/{id}", sessionId)
                        .header("Authorization", bearer(USER_ID)))
                .andReturn());
    }

    private JsonNode json(MvcResult result) throws Exception {
        return mapper.readTree(result.getResponse().getContentAsByteArray());
    }

    private void assertError(MvcResult result, int status, String detail) throws Exception {
        assertThat(result.getResponse().getStatus()).isEqualTo(status);
        assertThat(json(result)).isEqualTo(mapper.readTree(
                "{\"detail\":\"" + detail + "\"}"));
    }

    private String bearer(UUID userId) {
        return "Bearer " + jwt.issueAccessToken(userId).value();
    }

    private static String validBody(UUID uploadId) {
        return """
                {"upload_intent_id":"%s","situation":"상황","character_context":"인물",
                 "goal":"목표","blockage_kind":"분석","sub_branch":"대사 분석",
                 "blockage_detail":null}
                """.formatted(uploadId);
    }

    private void insertUser(UUID id) {
        jdbc.update("INSERT INTO users(id,status) VALUES (?,'active'::user_status_t)", id);
    }

    private UUID insertUpload(UUID userId, String status, String objectKey) {
        UUID id = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO upload_intents(
                    id,user_id,status,storage_provider,object_key,mime_type,size_bytes,expires_at)
                VALUES (?,?,?::upload_status_t,'s3',?,'video/mp4',12,?)
                """, id, userId, status, objectKey, NOW.plusHours(1));
        return id;
    }

    private UUID insertSummary(UUID sessionId) {
        UUID id = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO summaries(
                    id,session_id,model,was_compressed,raw,observations_json,uncertainties_json)
                VALUES (?,?,'fixture',false,'{}'::jsonb,
                    '[{"start_ms":0,"end_ms":10,"label":"한국어 관찰","confidence":0.9}]'::jsonb,
                    '["불확실"]'::jsonb)
                """, id, sessionId);
        return id;
    }

    @TestConfiguration(proxyBeanMethods = false)
    static class StorageFixture {
        @Bean
        @Primary
        ObjectStorage storage() {
            return new FakeStorage();
        }
    }

    static final class FakeStorage implements ObjectStorage {
        @Override
        public String presignUpload(
                String objectKey, String mimeType, long sizeBytes, int expiresInSeconds) {
            return "https://example.test/upload/" + objectKey;
        }

        @Override
        public String presignPlayback(String objectKey, int expiresInSeconds) {
            return "https://example.test/playback/" + objectKey;
        }

        @Override
        public StoredObjectMetadata head(String objectKey) {
            return new StoredObjectMetadata(12, "video/mp4", "\"etag\"");
        }

        @Override
        public StoredObjectMetadata downloadToPath(String objectKey, Path destination) {
            return head(objectKey);
        }

        @Override
        public void delete(String objectKey) {
        }
    }
}
