package com.acttub.actingapi.feature.upload;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import java.nio.file.Path;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.UUID;

import com.acttub.actingapi.feature.auth.app.JwtService;
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
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest(properties = "JWT_SECRET=test-secret")
@AutoConfigureMockMvc
@Import(UploadEndpointIT.StorageFixture.class)
class UploadEndpointIT {
    private static final UUID USER_ID =
            UUID.fromString("00000000-0000-4000-8000-000000000101");

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        String name = PostgresContainerSupport.createDatabaseName("upload_endpoint");
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
    FakeStorage storage;

    @BeforeEach
    void setUp() {
        jdbc.execute("TRUNCATE TABLE users,consent_documents RESTART IDENTITY CASCADE");
        jdbc.update("INSERT INTO users(id,status) VALUES (?,'active'::user_status_t)", USER_ID);
        storage.metadata = new StoredObjectMetadata(12, "video/mp4", "\"etag-12\"");
    }

    @Test
    void uploadRequestAloneAcceptsUnknownKeysAndIntegralFloats() throws Exception {
        var accepted = mvc.perform(post("/v2/uploads/intents")
                        .header("Authorization", bearer())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"mime_type":" video/mp4 ","size_bytes":12.0,
                                 "duration_ms":1000.0,"unknown":true}
                                """))
                .andReturn().getResponse();

        assertThat(accepted.getStatus()).isEqualTo(201);
        JsonNode body = mapper.readTree(accepted.getContentAsString());
        UUID intentId = UUID.fromString(body.path("intent_id").textValue());
        assertThat(body.path("expires_at").textValue())
                .matches("\\d{4}-\\d{2}-\\d{2}T.*\\.\\d{6}Z");
        assertThat(storage.lastObjectKey)
                .startsWith("users/" + USER_ID + "/uploads/")
                .endsWith(".mp4");
        assertThat(jdbc.queryForObject(
                "SELECT mime_type FROM upload_intents WHERE id=?", String.class, intentId))
                .isEqualTo("video/mp4");

        var fractional = mvc.perform(post("/v2/uploads/intents")
                        .header("Authorization", bearer())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"mime_type\":\"video/mp4\",\"size_bytes\":12.5}"))
                .andReturn().getResponse();
        assertThat(fractional.getStatus()).isEqualTo(422);
        assertThat(mapper.readTree(fractional.getContentAsString())
                .path("detail").get(0).path("type").textValue()).isEqualTo("int_from_float");
    }

    @Test
    void completionUsesUpdateReturningAndIsIdempotent() throws Exception {
        UUID intentId = createIntent();

        var first = mvc.perform(post("/v2/uploads/intents/{id}/complete", intentId)
                        .header("Authorization", bearer()))
                .andReturn().getResponse();
        assertThat(first.getStatus()).isEqualTo(200);
        assertThat(mapper.readTree(first.getContentAsString()))
                .isEqualTo(mapper.readTree("""
                        {"intent_id":"%s","status":"finalized"}
                        """.formatted(intentId)));
        assertThat(jdbc.queryForMap(
                "SELECT status::text,etag,finalized_at FROM upload_intents WHERE id=?", intentId))
                .containsEntry("status", "finalized")
                .containsEntry("etag", "\"etag-12\"");

        var replay = mvc.perform(post("/v2/uploads/intents/{id}/complete", intentId)
                        .header("Authorization", bearer()))
                .andReturn().getResponse();
        assertThat(replay.getStatus()).isEqualTo(200);
    }

    @Test
    void expiredAndForeignIntentsDoNotLeakOwnership() throws Exception {
        UUID intentId = createIntent();
        jdbc.update("UPDATE upload_intents SET expires_at=now()-interval '1 second' WHERE id=?", intentId);

        var expired = mvc.perform(post("/v2/uploads/intents/{id}/complete", intentId)
                        .header("Authorization", bearer()))
                .andReturn().getResponse();
        assertThat(expired.getStatus()).isEqualTo(409);
        assertThat(mapper.readTree(expired.getContentAsString()).path("detail").textValue())
                .isEqualTo("upload_intent_expired");

        UUID other = UUID.fromString("00000000-0000-4000-8000-000000000102");
        jdbc.update("INSERT INTO users(id,status) VALUES (?,'active'::user_status_t)", other);
        var hidden = mvc.perform(post("/v2/uploads/intents/{id}/complete", intentId)
                        .header("Authorization", "Bearer " + jwt.issueAccessToken(other).value()))
                .andReturn().getResponse();
        assertThat(hidden.getStatus()).isEqualTo(404);
        assertThat(mapper.readTree(hidden.getContentAsString()).path("detail").textValue())
                .isEqualTo("upload_intent_not_found");
    }

    @Test
    void uploadsUseTheExistingConsentedUserGate() throws Exception {
        UUID document = UUID.fromString("00000000-0000-4000-8000-000000000201");
        jdbc.update("""
                INSERT INTO consent_documents(id,type,version,title,body,required,published_at)
                VALUES (?,'terms'::consent_type_t,'v1','약관','본문',true,?)
                """, document, OffsetDateTime.now(ZoneOffset.UTC));

        var blocked = mvc.perform(post("/v2/uploads/intents")
                        .header("Authorization", bearer())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"mime_type\":\"video/mp4\",\"size_bytes\":-1}"))
                .andReturn().getResponse();
        assertThat(blocked.getStatus()).isEqualTo(403);
        assertThat(mapper.readTree(blocked.getContentAsString()).path("detail").textValue())
                .isEqualTo("consent_required");

        jdbc.update("""
                INSERT INTO user_consents(id,user_id,document_id,action)
                VALUES (?,?,?,'granted'::consent_action_t)
                """, UUID.randomUUID(), USER_ID, document);
        var allowed = mvc.perform(post("/v2/uploads/intents")
                        .header("Authorization", bearer())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"mime_type\":\"video/mp4\",\"size_bytes\":12}"))
                .andReturn().getResponse();
        assertThat(allowed.getStatus()).isEqualTo(201);
    }

    @Test
    void malformedIntentIdUsesPydanticPathUuidError() throws Exception {
        var response = mvc.perform(post("/v2/uploads/intents/not-a-uuid/complete")
                        .header("Authorization", bearer()))
                .andReturn().getResponse();

        assertThat(response.getStatus()).isEqualTo(422);
        assertThat(mapper.readTree(response.getContentAsString()))
                .isEqualTo(mapper.readTree("""
                        {"detail":[{
                          "type":"uuid_parsing",
                          "loc":["path","intent_id"],
                          "msg":"Input should be a valid UUID, invalid character: found `n` at 1",
                          "input":"not-a-uuid",
                          "ctx":{"error":"invalid character: found `n` at 1"}
                        }]}
                        """));
    }

    private UUID createIntent() throws Exception {
        var response = mvc.perform(post("/v2/uploads/intents")
                        .header("Authorization", bearer())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"mime_type\":\"video/mp4\",\"size_bytes\":12}"))
                .andReturn().getResponse();
        assertThat(response.getStatus()).isEqualTo(201);
        return UUID.fromString(mapper.readTree(response.getContentAsString())
                .path("intent_id").textValue());
    }

    private String bearer() {
        return "Bearer " + jwt.issueAccessToken(USER_ID).value();
    }

    @TestConfiguration(proxyBeanMethods = false)
    static class StorageFixture {
        @Bean
        @Primary
        FakeStorage fakeStorage() {
            return new FakeStorage();
        }
    }

    static final class FakeStorage implements ObjectStorage {
        private String lastObjectKey;
        private StoredObjectMetadata metadata;

        @Override
        public String presignUpload(
                String objectKey,
                String mimeType,
                long sizeBytes,
                int expiresInSeconds) {
            this.lastObjectKey = objectKey;
            return "https://s3.ap-northeast-2.amazonaws.com/harness/" + objectKey;
        }

        @Override
        public StoredObjectMetadata head(String objectKey) {
            return metadata;
        }

        @Override
        public String presignPlayback(String objectKey, int expiresInSeconds) {
            return "https://s3.ap-northeast-2.amazonaws.com/harness/" + objectKey;
        }

        @Override
        public StoredObjectMetadata downloadToPath(String objectKey, Path destination) {
            return metadata;
        }

        @Override
        public void delete(String objectKey) {
        }
    }
}
