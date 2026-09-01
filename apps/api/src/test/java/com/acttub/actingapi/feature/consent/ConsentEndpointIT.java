package com.acttub.actingapi.feature.consent;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.UUID;
import java.util.stream.Stream;

import com.acttub.actingapi.feature.auth.app.JwtService;
import com.acttub.actingapi.support.PostgresContainerSupport;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest(properties = {"JWT_SECRET=test-secret", "DEVELOPMENT_AUTH_PROVIDER=1"})
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
        jdbc.update("INSERT INTO users(id,status) VALUES (?,'active')", USER_ID);
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
    void entryRequiresDecisionForEveryUndecidedLatestDocument() throws Exception {
        JsonNode entry = consentEntry();

        assertThat(entry.path("entry_status").textValue()).isEqualTo("decision_required");
        assertThat(entry.path("documents")).hasSize(2);
        assertThat(entry.path("documents").get(0).path("id").textValue())
                .isEqualTo(LATEST_TERMS_HIGH_ID.toString());
        assertThat(entry.path("documents").get(1).path("id").textValue())
                .isEqualTo(PRIVACY.toString());
        assertThat(entry.path("documents").get(0).has("current_decision")).isTrue();
        assertThat(entry.path("documents").get(0).path("current_decision").isNull()).isTrue();
        assertThat(entry.path("documents").get(1).path("current_decision").isNull()).isTrue();
        assertThat(entry.path("undecided_documents")).hasSize(2);
    }

    @ParameterizedTest(name = "required={0}, decision={1} -> {2}")
    @MethodSource("entryStatusCases")
    void entryStatusUsesRequiredAndCurrentDecision(
            boolean required,
            String currentDecision,
            String expectedStatus,
            int expectedUndecidedDocuments) throws Exception {
        jdbc.execute("TRUNCATE TABLE consent_documents RESTART IDENTITY CASCADE");
        insertDocument(
                LATEST_TERMS_HIGH_ID,
                "terms",
                "v1",
                "약관",
                required,
                OffsetDateTime.of(2026, 1, 2, 0, 0, 0, 0, ZoneOffset.UTC));
        if (currentDecision != null) {
            insertConsent(
                    id(301),
                    LATEST_TERMS_HIGH_ID,
                    currentDecision,
                    OffsetDateTime.of(2026, 1, 3, 0, 0, 0, 0, ZoneOffset.UTC));
        }

        JsonNode entry = consentEntry();

        assertThat(entry.path("entry_status").textValue()).isEqualTo(expectedStatus);
        assertThat(entry.path("documents")).hasSize(1);
        JsonNode decision = entry.path("documents").get(0).path("current_decision");
        if (currentDecision == null) {
            assertThat(decision.isNull()).isTrue();
        } else {
            assertThat(decision.textValue()).isEqualTo(currentDecision);
        }
        assertThat(entry.path("undecided_documents")).hasSize(expectedUndecidedDocuments);
    }

    private static Stream<Arguments> entryStatusCases() {
        return Stream.of(
                Arguments.of(true, null, "decision_required", 1),
                Arguments.of(true, "granted", "allowed", 0),
                Arguments.of(true, "declined", "blocked", 0),
                Arguments.of(true, "revoked", "blocked", 0),
                Arguments.of(false, null, "decision_required", 1),
                Arguments.of(false, "granted", "allowed", 0),
                Arguments.of(false, "declined", "allowed", 0),
                Arguments.of(false, "revoked", "allowed", 0));
    }

    @Test
    void blockedRequiredDecisionTakesPriorityOverUndecidedOptionalDocument() throws Exception {
        insertConsent(
                id(301),
                LATEST_TERMS_HIGH_ID,
                "declined",
                OffsetDateTime.of(2026, 1, 3, 0, 0, 0, 0, ZoneOffset.UTC));

        JsonNode entry = consentEntry();

        assertThat(entry.path("entry_status").textValue()).isEqualTo("blocked");
        assertThat(entry.path("undecided_documents")).hasSize(1);
        assertThat(entry.path("undecided_documents").get(0).path("id").textValue())
                .isEqualTo(PRIVACY.toString());
    }

    @Test
    void decisionForPreviousVersionDoesNotDecideTheLatestVersion() throws Exception {
        OffsetDateTime occurredAt = OffsetDateTime.of(
                2026, 1, 3, 0, 0, 0, 0, ZoneOffset.UTC);
        insertConsent(id(301), OLD_TERMS, "granted", occurredAt);
        insertConsent(id(302), PRIVACY, "granted", occurredAt);

        JsonNode entry = consentEntry();

        assertThat(entry.path("entry_status").textValue()).isEqualTo("decision_required");
        assertThat(entry.path("undecided_documents")).hasSize(1);
        assertThat(entry.path("undecided_documents").get(0).path("id").textValue())
                .isEqualTo(LATEST_TERMS_HIGH_ID.toString());
    }

    @Test
    void entryUsesOccurredAtThenIdToChooseTheCurrentDecision() throws Exception {
        OffsetDateTime occurredAt = OffsetDateTime.of(
                2026, 1, 3, 0, 0, 0, 0, ZoneOffset.UTC);
        insertConsent(id(301), LATEST_TERMS_HIGH_ID, "granted", occurredAt);
        insertConsent(id(302), LATEST_TERMS_HIGH_ID, "revoked", occurredAt);
        insertConsent(id(303), PRIVACY, "granted", occurredAt);

        JsonNode entry = consentEntry();

        assertThat(entry.path("entry_status").textValue()).isEqualTo("blocked");
        assertThat(entry.path("documents").get(0).path("current_decision").textValue())
                .isEqualTo("revoked");
        assertThat(entry.path("undecided_documents")).isEmpty();
    }

    @Test
    void loginAndEntryUseTheSameLatestDocumentVersion() throws Exception {
        var loginResponse = mvc.perform(post("/v2/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"provider\":\"development\",\"id_token\":\"dev-consent-entry\"}"))
                .andReturn().getResponse();
        assertThat(loginResponse.getStatus()).isEqualTo(200);
        JsonNode login = mapper.readTree(loginResponse.getContentAsString());

        assertThat(login.path("pending_consents")).hasSize(1);
        assertThat(login.path("pending_consents").get(0).path("id").textValue())
                .isEqualTo(LATEST_TERMS_HIGH_ID.toString());

        JsonNode entry = consentEntry(login.path("access_token").textValue());
        assertThat(entry.path("documents").get(0).path("id").textValue())
                .isEqualTo(LATEST_TERMS_HIGH_ID.toString());
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

    @Test
    void requiredDocumentCannotBeDeclinedAndDoesNotCreateHistory() throws Exception {
        var rejected = mvc.perform(post("/v2/consents")
                        .header("Authorization", bearer())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"document_id":"%s","action":"declined"}
                                """.formatted(LATEST_TERMS_HIGH_ID)))
                .andReturn().getResponse();

        assertThat(rejected.getStatus()).isEqualTo(409);
        assertThat(mapper.readTree(rejected.getContentAsString()))
                .isEqualTo(mapper.readTree(
                        "{\"detail\":\"required_consent_cannot_be_declined\"}"));
        assertThat(consentEntry().path("documents").get(0).path("current_decision").isNull())
                .isTrue();

        var optional = mvc.perform(post("/v2/consents")
                        .header("Authorization", bearer())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"document_id":"%s","action":"declined"}
                                """.formatted(PRIVACY)))
                .andReturn().getResponse();

        assertThat(optional.getStatus()).isEqualTo(201);
    }

    @Test
    void capableClientsDistinguishBlockedConsentWithoutChangingTheLegacyError() throws Exception {
        var undecided = protectedUpload(true);
        assertThat(undecided.getStatus()).isEqualTo(403);
        assertThat(mapper.readTree(undecided.getContentAsString()).path("detail").textValue())
                .isEqualTo("consent_required");

        insertConsent(
                id(301),
                LATEST_TERMS_HIGH_ID,
                "declined",
                OffsetDateTime.of(2026, 1, 3, 0, 0, 0, 0, ZoneOffset.UTC));

        var capable = protectedUpload(true);
        assertThat(capable.getStatus()).isEqualTo(403);
        assertThat(mapper.readTree(capable.getContentAsString()).path("detail").textValue())
                .isEqualTo("consent_blocked");

        var legacy = protectedUpload(false);
        assertThat(legacy.getStatus()).isEqualTo(403);
        assertThat(mapper.readTree(legacy.getContentAsString()).path("detail").textValue())
                .isEqualTo("consent_required");

        insertConsent(
                id(302),
                LATEST_TERMS_HIGH_ID,
                "revoked",
                OffsetDateTime.of(2026, 1, 3, 0, 0, 1, 0, ZoneOffset.UTC));
        var revoked = protectedUpload(true);
        assertThat(revoked.getStatus()).isEqualTo(403);
        assertThat(mapper.readTree(revoked.getContentAsString()).path("detail").textValue())
                .isEqualTo("consent_blocked");

        JsonNode entry = consentEntry();
        assertThat(entry.path("entry_status").textValue()).isEqualTo("blocked");

        var granted = mvc.perform(post("/v2/consents")
                        .header("Authorization", bearer())
                        .header("X-Acttub-Consent-Entry", "1")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"document_id":"%s","action":"granted"}
                                """.formatted(LATEST_TERMS_HIGH_ID)))
                .andReturn().getResponse();
        assertThat(granted.getStatus()).isEqualTo(201);
        assertThat(protectedUpload(true).getStatus()).isNotEqualTo(403);
    }

    /**
     * consents.py:ConsentRequest 는 extra 를 지정하지 않아 unknown key 를 <b>받는다</b>.
     * openapi.json 의 ConsentRequest 에도 additionalProperties 가 없다 —
     * apps/api/CONTRACT.md §6-3 이 허용 목록 5개에 POST /v2/consents 를 넣은 근거이며, 그중 M3 범위는
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
                VALUES (?,?,?,?,?, ?,?)
                """, id, type, version, title, title + " 본문", required, publishedAt);
    }

    private void insertConsent(
            UUID id,
            UUID documentId,
            String action,
            OffsetDateTime occurredAt) {
        jdbc.update("""
                INSERT INTO user_consents(id,user_id,document_id,action,occurred_at)
                VALUES (?,?,?,?,?)
                """, id, USER_ID, documentId, action, occurredAt);
    }

    private JsonNode pendingDocuments() throws Exception {
        var response = mvc.perform(get("/v2/consents/pending")
                        .header("Authorization", bearer()))
                .andReturn().getResponse();
        assertThat(response.getStatus()).isEqualTo(200);
        return mapper.readTree(response.getContentAsString()).path("documents");
    }

    private JsonNode consentEntry() throws Exception {
        return consentEntry(jwt.issueAccessToken(USER_ID).value());
    }

    private JsonNode consentEntry(String accessToken) throws Exception {
        var response = mvc.perform(get("/v2/consents/entry")
                        .header("Authorization", "Bearer " + accessToken))
                .andReturn().getResponse();
        assertThat(response.getStatus()).isEqualTo(200);
        return mapper.readTree(response.getContentAsString());
    }

    private MockHttpServletResponse protectedUpload(boolean capable) throws Exception {
        var request = post("/v2/uploads/intents")
                .header("Authorization", bearer())
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"mime_type\":\"video/mp4\",\"size_bytes\":12}");
        if (capable) {
            request.header("X-Acttub-Consent-Entry", "1");
        }
        return mvc.perform(request).andReturn().getResponse();
    }

    private String bearer() {
        return "Bearer " + jwt.issueAccessToken(USER_ID).value();
    }

    private static UUID id(int suffix) {
        return UUID.fromString("00000000-0000-4000-8000-%012d".formatted(suffix));
    }
}
