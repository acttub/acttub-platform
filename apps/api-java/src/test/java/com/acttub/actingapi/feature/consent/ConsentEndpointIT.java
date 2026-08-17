package com.acttub.actingapi.feature.consent;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.UUID;

import com.acttub.actingapi.feature.auth.app.JwtService;
import com.acttub.actingapi.support.PostgresContainerSupport;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.http.MediaType;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest(properties = "JWT_SECRET=test-secret")
@AutoConfigureMockMvc
class ConsentEndpointIT {
    private static final UUID USER_ID = id(101);
    private static final UUID OLD_TERMS = id(201);
    private static final UUID LATEST_TERMS_LOW_ID = id(202);
    private static final UUID LATEST_TERMS_HIGH_ID = id(203);
    private static final UUID PRIVACY = id(204);

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        String name = PostgresContainerSupport.createDatabaseName("consent_endpoint");
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

    @BeforeEach
    void setUp() {
        jdbc.execute("TRUNCATE TABLE users,consent_documents RESTART IDENTITY CASCADE");
        jdbc.update("INSERT INTO users(id,status) VALUES (?,'active'::user_status_t)", USER_ID);
        OffsetDateTime old = OffsetDateTime.of(2026, 1, 1, 0, 0, 0, 0, ZoneOffset.UTC);
        OffsetDateTime latest = old.plusDays(1);
        insertDocument(OLD_TERMS, "terms", "v1", "옛 약관", true, old);
        insertDocument(LATEST_TERMS_LOW_ID, "terms", "v2-low", "낮은 id", true, latest);
        insertDocument(LATEST_TERMS_HIGH_ID, "terms", "v2", "최신 약관", true, latest);
        insertDocument(PRIVACY, "privacy", "v1", "개인정보", false, old);
    }

    @Test
    void latestDocumentsUseDistinctOnTypePublishedAtAndIdOrdering() throws Exception {
        var response = mvc.perform(get("/v2/consents/documents"))
                .andReturn().getResponse();

        assertThat(response.getStatus()).isEqualTo(200);
        JsonNode documents = mapper.readTree(response.getContentAsString()).path("documents");
        assertThat(documents).hasSize(2);
        assertThat(documents.get(0).path("id").textValue())
                .isEqualTo(LATEST_TERMS_HIGH_ID.toString());
        assertThat(documents.get(1).path("id").textValue())
                .isEqualTo(PRIVACY.toString());
        assertThat(documents.get(0).path("published_at").textValue())
                .isEqualTo("2026-01-02T00:00:00.000000Z");
    }

    @Test
    void pendingUsesLatestConsentByOccurredAtThenId() throws Exception {
        OffsetDateTime occurredAt = OffsetDateTime.of(
                2026, 1, 3, 0, 0, 0, 0, ZoneOffset.UTC);
        insertConsent(id(301), LATEST_TERMS_HIGH_ID, "granted", occurredAt);
        insertConsent(id(302), LATEST_TERMS_HIGH_ID, "revoked", occurredAt);

        JsonNode pending = pendingDocuments();

        assertThat(pending).hasSize(1);
        assertThat(pending.get(0).path("id").textValue())
                .isEqualTo(LATEST_TERMS_HIGH_ID.toString());

        insertConsent(id(303), LATEST_TERMS_HIGH_ID, "granted", occurredAt.plusSeconds(1));
        assertThat(pendingDocuments()).isEmpty();
    }

    @Test
    void recordingConsentReturnsCreatedEventAndInvalidDocumentIsHiddenAsNotFound() throws Exception {
        var created = mvc.perform(post("/v2/consents")
                        .header("Authorization", bearer())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"document_id":"%s","action":"granted"}
                                """.formatted(LATEST_TERMS_HIGH_ID)))
                .andReturn().getResponse();
        assertThat(created.getStatus()).isEqualTo(201);
        JsonNode body = mapper.readTree(created.getContentAsString());
        assertThat(body.path("document_id").textValue())
                .isEqualTo(LATEST_TERMS_HIGH_ID.toString());
        assertThat(body.path("action").textValue()).isEqualTo("granted");
        assertThat(body.path("occurred_at").textValue())
                .matches("\\d{4}-\\d{2}-\\d{2}T.*\\.\\d{6}Z");

        var missing = mvc.perform(post("/v2/consents")
                        .header("Authorization", bearer())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"document_id\":\"not-a-uuid\",\"action\":\"granted\"}"))
                .andReturn().getResponse();
        assertThat(missing.getStatus()).isEqualTo(404);
        assertThat(mapper.readTree(missing.getContentAsString()))
                .isEqualTo(mapper.readTree("{\"detail\":\"consent_document_not_found\"}"));
    }

    /**
     * consents.py:ConsentRequest 는 extra 를 지정하지 않아 unknown key 를 <b>받는다</b>.
     * openapi.json 의 ConsentRequest 에도 additionalProperties 가 없다 —
     * /SPEC.md §6-3 이 허용 목록 5개에 POST /v2/consents 를 넣은 근거이며, 그중 M3 범위는
     * 이것과 POST /v2/uploads/intents 둘이다.
     */
    @Test
    void consentRequestAcceptsUnknownKeys() throws Exception {
        var response = mvc.perform(post("/v2/consents")
                        .header("Authorization", bearer())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"document_id":"%s","action":"granted","unknown":true}
                                """.formatted(LATEST_TERMS_HIGH_ID)))
                .andReturn().getResponse();

        assertThat(response.getStatus()).isEqualTo(201);
    }

    private void insertDocument(
            UUID id,
            String type,
            String version,
            String title,
            boolean required,
            OffsetDateTime publishedAt) {
        jdbc.update("""
                INSERT INTO consent_documents(id,type,version,title,body,required,published_at)
                VALUES (?,?::consent_type_t,?,?,?, ?,?)
                """, id, type, version, title, title + " 본문", required, publishedAt);
    }

    private void insertConsent(
            UUID id,
            UUID documentId,
            String action,
            OffsetDateTime occurredAt) {
        jdbc.update("""
                INSERT INTO user_consents(id,user_id,document_id,action,occurred_at)
                VALUES (?,?,?,?::consent_action_t,?)
                """, id, USER_ID, documentId, action, occurredAt);
    }

    private JsonNode pendingDocuments() throws Exception {
        var response = mvc.perform(get("/v2/consents/pending")
                        .header("Authorization", bearer()))
                .andReturn().getResponse();
        assertThat(response.getStatus()).isEqualTo(200);
        return mapper.readTree(response.getContentAsString()).path("documents");
    }

    private String bearer() {
        return "Bearer " + jwt.issueAccessToken(USER_ID).value();
    }

    private static UUID id(int suffix) {
        return UUID.fromString("00000000-0000-4000-8000-%012d".formatted(suffix));
    }
}
