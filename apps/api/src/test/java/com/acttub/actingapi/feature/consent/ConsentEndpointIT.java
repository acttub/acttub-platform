package com.acttub.actingapi.feature.consent;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.auth.app.JwtService;
import com.acttub.actingapi.support.AccountFixtures;
import com.acttub.actingapi.support.MutableClock;
import com.acttub.actingapi.support.PostgresContainerSupport;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;

/**
 * account.consent 의 "검증 방법"을 HTTP 와 실제 Postgres 로 본다.
 *
 * <p>회원은 프로필을 채워 둔 상태로 세운다 — 여기서 보려는 것은 동의이고, 보호 API 가 열렸는지는
 * 동의만으로 갈려야 한다. 영상 보관 결정이 탈퇴의 파기에 미치는 영향은 탈퇴 쪽 테스트가 본다.
 */
@SpringBootTest(properties = "JWT_SECRET=test-secret")
@AutoConfigureMockMvc
@Import(MutableClock.Fixture.class)
class ConsentEndpointIT {
    private static final UUID USER_ID = id(101);
    private static final UUID OLD_TERMS = id(201);
    private static final UUID TERMS_LOW_ID = id(202);
    private static final UUID TERMS = id(203);
    private static final UUID PRIVACY = id(204);
    private static final UUID AI_ANALYSIS = id(205);
    private static final UUID RETENTION = id(206);

    private static final OffsetDateTime OLD = OffsetDateTime.of(2026, 1, 1, 0, 0, 0, 0, ZoneOffset.UTC);
    private static final OffsetDateTime CURRENT = OLD.plusDays(1);
    private static final OffsetDateTime DECIDED = OLD.plusDays(2);

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

    @Autowired
    MutableClock clock;

    @BeforeEach
    void setUp() {
        clock.set(Instant.now().truncatedTo(java.time.temporal.ChronoUnit.SECONDS));
        jdbc.execute("TRUNCATE TABLE users,consent_documents RESTART IDENTITY CASCADE");
        jdbc.update("INSERT INTO users(id,status) VALUES (?,'active')", USER_ID);
        AccountFixtures.completeProfile(jdbc, USER_ID);
        insertDocument(OLD_TERMS, "terms", "v1", "옛 약관", true, OLD);
        // 발행 시각이 같으면 식별자가 큰 쪽이 현재 판이다.
        insertDocument(TERMS_LOW_ID, "terms", "v2-low", "낮은 id", true, CURRENT);
        insertDocument(TERMS, "terms", "v2", "서비스 이용약관", true, CURRENT);
        insertDocument(PRIVACY, "privacy", "v5", "개인정보 수집·이용 동의", true, CURRENT);
        insertDocument(AI_ANALYSIS, "ai_analysis", "v1", "AI 분석 동의", true, OLD);
        insertDocument(RETENTION, "retention", "v1", "탈퇴 후 영상·녹음 보관·활용", false, CURRENT);
    }

    @Test
    void accountConsent_publicDocumentsAreTheCurrentVersionsInDisplayOrderWithOrWithoutAToken()
            throws Exception {
        for (var request : List.of(
                get("/v2/consents/documents"),
                get("/v2/consents/documents").header("Authorization", bearer()))) {
            var response = mvc.perform(request).andReturn().getResponse();

            assertThat(response.getStatus()).isEqualTo(200);
            JsonNode documents = mapper.readTree(response.getContentAsString()).path("documents");
            assertThat(documents).extracting(document -> document.path("id").textValue())
                    .as("약관 · 수집·이용 동의 · AI 분석 · 탈퇴 후 보관, 옛 판은 나오지 않는다")
                    .containsExactly(TERMS.toString(), PRIVACY.toString(),
                            AI_ANALYSIS.toString(), RETENTION.toString());
            assertThat(documents.get(3).path("required").booleanValue()).isFalse();
            // 시행일은 발행 시각이다.
            assertThat(documents.get(0).path("published_at").textValue())
                    .isEqualTo("2026-01-02T00:00:00.000000Z");
            assertThat(documents.get(0).path("body").textValue()).isEqualTo("서비스 이용약관 본문");
        }
    }

    /**
     * 개인정보 처리방침은 동의를 받는 문서가 아니라 고지다. 결정 대상 목록에는 없고, 공개 페이지가 함께
     * 싣도록 따로 내준다. 수탁사 고지(계측 포함)가 이 문서에 있다 — 배포 가드가 같은 파일을 본다.
     */
    @Test
    void accountConsent_privacyPolicyIsAPublicNoticeAndNeverADecisionTarget() throws Exception {
        for (var request : List.of(
                get("/v2/consents/notices"),
                // 만료된 토큰을 전역으로 붙이는 클라이언트도 읽을 수 있어야 한다.
                get("/v2/consents/notices").header("Authorization", "Bearer expired"))) {
            var response = mvc.perform(request).andReturn().getResponse();

            assertThat(response.getStatus()).isEqualTo(200);
            JsonNode notices = mapper.readTree(response.getContentAsString()).path("notices");
            assertThat(notices).hasSize(1);
            assertThat(notices.get(0).fieldNames()).toIterable()
                    .containsExactlyInAnyOrder("type", "title", "body");
            assertThat(notices.get(0).path("type").textValue()).isEqualTo("privacy_policy");
            assertThat(notices.get(0).path("title").textValue()).isEqualTo("개인정보 처리방침");
            assertThat(notices.get(0).path("body").textValue())
                    .contains("개인정보 처리의 위탁")
                    .contains("Amplitude, Inc.");
        }

        assertThat(jdbc.queryForObject(
                "SELECT count(*) FROM consent_documents WHERE title LIKE '%처리방침%'", Integer.class))
                .as("고지는 consent_documents 의 행이 아니다 — 게이트에 걸리지 않는다")
                .isZero();
        var documents = mapper.readTree(mvc.perform(get("/v2/consents/documents"))
                .andReturn().getResponse().getContentAsString()).path("documents");
        assertThat(documents).extracting(document -> document.path("type").textValue())
                .doesNotContain("privacy_policy");
    }

    /**
     * 웹은 계측을 켤지 말지를 이 응답의 privacy 행 {@code current_decision === "granted"} 하나로 정한다.
     * 그래서 이 값은 <b>현재 판</b>에 대한 결정이어야 한다 — 옛 판에만 동의한 사람이 granted 로 나오면
     * 새 수집이 옛 동의로 켜진다. 회원이든 게스트든 같다.
     */
    @ParameterizedTest(name = "{0}")
    @ValueSource(strings = {"google", "guest"})
    void accountConsent_privacyDecisionInTheEntryIsAboutTheCurrentVersionForMembersAndGuests(
            String provider) throws Exception {
        jdbc.update("""
                INSERT INTO user_identities(id,user_id,provider,provider_uid)
                VALUES (?,?,?,'uid-for-entry')
                """, UUID.randomUUID(), USER_ID, provider);
        // 게스트의 첫 동의에는 "만 14세 이상이에요" 확인이 실려야 한다. 이미 확인한 게스트로 둔다 — 여기서
        // 보려는 것은 판이다(확인 줄은 AccountGuestIT 가 본다).
        jdbc.update("UPDATE users SET age_confirmed_at=now() WHERE id=?", USER_ID);
        UUID oldPrivacy = id(208);
        insertDocument(oldPrivacy, "privacy", "v4", "개인정보처리방침", true, OLD);
        insertConsent(id(301), oldPrivacy, "granted", DECIDED);

        JsonNode before = privacyRow(consentEntry());
        assertThat(before.path("id").textValue()).isEqualTo(PRIVACY.toString());
        assertThat(before.path("version").textValue()).isEqualTo("v5");
        assertThat(before.path("current_decision").isNull())
                .as("옛 판(v4)에만 동의했다 — 현재 판은 미결정이다")
                .isTrue();

        assertThat(decide(PRIVACY, "granted").getStatus()).isEqualTo(201);

        assertThat(privacyRow(consentEntry()).path("current_decision").textValue()).isEqualTo("granted");
    }

    private static JsonNode privacyRow(JsonNode entry) {
        for (JsonNode document : entry.path("documents")) {
            if ("privacy".equals(document.path("type").textValue())) {
                return document;
            }
        }
        throw new AssertionError("entry 에 privacy 행이 없다");
    }

    @Test
    void accountConsent_settingsShowEveryDocumentWithItsVersionEffectiveDateDecisionAndDecisionTime()
            throws Exception {
        insertConsent(id(301), TERMS, "granted", DECIDED);
        insertConsent(id(302), PRIVACY, "granted", DECIDED);
        insertConsent(id(303), AI_ANALYSIS, "granted", DECIDED);
        insertConsent(id(304), RETENTION, "declined", DECIDED.plusHours(1));

        JsonNode entry = consentEntry();

        assertThat(entry.path("entry_status").textValue()).isEqualTo("allowed");
        assertThat(entry.path("undecided_documents")).isEmpty();
        assertThat(entry.path("documents")).hasSize(4);
        JsonNode terms = entry.path("documents").get(0);
        assertThat(terms.path("title").textValue()).isEqualTo("서비스 이용약관");
        assertThat(terms.path("version").textValue()).isEqualTo("v2");
        assertThat(terms.path("published_at").textValue()).isEqualTo("2026-01-02T00:00:00.000000Z");
        assertThat(terms.path("current_decision").textValue()).isEqualTo("granted");
        assertThat(terms.path("decided_at").textValue()).isEqualTo("2026-01-03T00:00:00.000000Z");
        JsonNode retention = entry.path("documents").get(3);
        assertThat(retention.path("required").booleanValue()).isFalse();
        assertThat(retention.path("current_decision").textValue()).isEqualTo("declined");
        assertThat(retention.path("decided_at").textValue()).isEqualTo("2026-01-03T01:00:00.000000Z");
    }

    @Test
    void accountConsent_entryListsEveryUndecidedCurrentDocumentIncludingTheOptionalOne() throws Exception {
        // 옛 판에 한 결정은 현재 판을 결정하지 않는다 — 결정은 판 단위다.
        insertConsent(id(301), OLD_TERMS, "granted", DECIDED);

        JsonNode entry = consentEntry();

        assertThat(entry.path("entry_status").textValue()).isEqualTo("decision_required");
        assertThat(entry.path("undecided_documents")).hasSize(4);
        for (JsonNode document : entry.path("documents")) {
            assertThat(document.has("current_decision")).isTrue();
            assertThat(document.path("current_decision").isNull()).isTrue();
            assertThat(document.path("decided_at").isNull()).isTrue();
        }
        assertThat(pendingDocuments()).extracting(document -> document.path("id").textValue())
                .containsExactly(TERMS.toString(), PRIVACY.toString(),
                        AI_ANALYSIS.toString(), RETENTION.toString());
    }

    @Test
    void accountConsent_currentDecisionIsTheLastRowByTimeThenId() throws Exception {
        grantRequired();
        insertConsent(id(311), RETENTION, "granted", DECIDED);
        insertConsent(id(312), RETENTION, "declined", DECIDED);

        assertThat(consentEntry().path("documents").get(3).path("current_decision").textValue())
                .isEqualTo("declined");
    }

    @Test
    void accountConsent_switchingTheOptionalDocumentStacksOneRowAndKeepsProtectedApisOpen()
            throws Exception {
        grantRequired();
        insertConsent(id(304), RETENTION, "granted", DECIDED);
        assertThat(protectedApi().getStatus()).isEqualTo(200);

        var changed = decide(RETENTION, "declined");

        assertThat(changed.getStatus()).isEqualTo(201);
        JsonNode body = mapper.readTree(changed.getContentAsString());
        assertThat(body.path("document_id").textValue()).isEqualTo(RETENTION.toString());
        assertThat(body.path("action").textValue()).isEqualTo("declined");
        assertThat(body.path("occurred_at").textValue()).matches("\\d{4}-\\d{2}-\\d{2}T.*\\.\\d{6}Z");
        assertThat(consentEntry().path("documents").get(3).path("current_decision").textValue())
                .isEqualTo("declined");
        assertThat(rows(RETENTION, "declined")).isEqualTo(1);
        assertThat(rows(RETENTION, "granted")).as("결정은 쌓기만 하고 고치지 않는다").isEqualTo(1);
        assertThat(protectedApi().getStatus()).as("거절도 결정이다").isEqualTo(200);
    }

    @Test
    void accountConsent_requiredDocumentCannotBeDeclinedAndLeavesNoHistory() throws Exception {
        var rejected = decide(TERMS, "declined");

        assertThat(rejected.getStatus()).isEqualTo(422);
        assertThat(mapper.readTree(rejected.getContentAsString()))
                .as("규칙에 걸린 422 의 본문은 사유 코드 하나다")
                .isEqualTo(mapper.readTree("{\"detail\":\"required_consent_cannot_be_declined\"}"));
        assertThat(rows(TERMS, "declined")).isZero();
    }

    @Test
    void accountConsent_revocationIsNotAnInputEvenForTheOptionalDocument() throws Exception {
        var rejected = decide(RETENTION, "revoked");

        assertThat(rejected.getStatus()).isEqualTo(422);
        assertThat(mapper.readTree(rejected.getContentAsString()).path("detail").isArray())
                .as("값 목록 밖의 값은 본문 모양 오류다")
                .isTrue();
        assertThat(rows(RETENTION, "revoked")).isZero();
    }

    @Test
    void accountConsent_decisionOnAnOldVersionIsOutdatedAndUnknownDocumentsAreHidden() throws Exception {
        var outdated = decide(OLD_TERMS, "granted");
        assertThat(outdated.getStatus()).isEqualTo(409);
        assertThat(mapper.readTree(outdated.getContentAsString()))
                .isEqualTo(mapper.readTree("{\"detail\":\"consent_document_outdated\"}"));
        assertThat(rows(OLD_TERMS, "granted")).isZero();

        for (String unknown : List.of(id(999).toString(), "not-a-uuid")) {
            var missing = mvc.perform(post("/v2/consents")
                            .header("Authorization", bearer())
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"document_id\":\"" + unknown + "\",\"action\":\"granted\"}"))
                    .andReturn().getResponse();
            assertThat(missing.getStatus()).isEqualTo(404);
            assertThat(mapper.readTree(missing.getContentAsString()))
                    .isEqualTo(mapper.readTree("{\"detail\":\"consent_document_not_found\"}"));
        }
    }

    @Test
    void accountConsent_resendingTheSameDecisionAddsNoRow() throws Exception {
        // 운영 시계는 나노초까지 준다. Postgres 는 마이크로초까지만 저장하므로, 첫 응답이 시계 값을 그대로
        // 돌려주면 두 번째(저장된 값을 다시 읽은 것)와 1µs 가 갈릴 수 있다 — CI 가 그렇게 실패했다.
        // 나노초 부분이 반올림되는 값을 심어 그 어긋남을 반드시 드러낸다.
        clock.set(clock.instant().plusNanos(999_999_999));
        var first = decide(TERMS, "granted");
        var second = decide(TERMS, "granted");

        assertThat(first.getStatus()).isEqualTo(201);
        assertThat(second.getStatus()).isEqualTo(200);
        assertThat(mapper.readTree(second.getContentAsString()))
                .as("이미 있는 결정 행을 그대로 돌려준다")
                .isEqualTo(mapper.readTree(first.getContentAsString()));
        assertThat(rows(TERMS, "granted")).isEqualTo(1);
    }

    @Test
    void accountConsent_newVersionOfTheOptionalDocumentIsTheOnlyPendingOneAndDecliningPasses()
            throws Exception {
        grantRequired();
        insertConsent(id(304), RETENTION, "granted", DECIDED);
        UUID retentionV2 = id(207);
        insertDocument(retentionV2, "retention", "v2", "탈퇴 후 영상·녹음 보관·활용", false,
                CURRENT.plusDays(30));

        var blocked = protectedApi();
        assertThat(blocked.getStatus()).isEqualTo(403);
        JsonNode body = mapper.readTree(blocked.getContentAsString());
        assertThat(body.path("detail").textValue()).isEqualTo("consent_required");
        assertThat(body.path("pending_consents")).hasSize(1);
        JsonNode pending = body.path("pending_consents").get(0);
        assertThat(pending.path("id").textValue()).isEqualTo(retentionV2.toString());
        assertThat(pending.path("type").textValue()).isEqualTo("retention");
        assertThat(pending.path("version").textValue()).isEqualTo("v2");
        assertThat(pending.path("required").booleanValue()).isFalse();
        assertThat(pending.path("body").textValue()).isEqualTo("탈퇴 후 영상·녹음 보관·활용 본문");
        assertThat(pending.path("published_at").textValue()).isEqualTo("2026-02-01T00:00:00.000000Z");
        // 다른 문서의 결정은 그대로다.
        assertThat(consentEntry().path("documents").get(0).path("current_decision").textValue())
                .isEqualTo("granted");

        assertThat(decide(retentionV2, "declined").getStatus()).isEqualTo(201);
        assertThat(protectedApi().getStatus()).isEqualTo(200);
    }

    @Test
    void accountConsent_memberWhoDeclinedARequiredDocumentBefore1_0_0IsTreatedAsUndecided()
            throws Exception {
        insertConsent(id(301), TERMS, "declined", DECIDED);
        insertConsent(id(302), PRIVACY, "revoked", DECIDED);
        insertConsent(id(303), AI_ANALYSIS, "granted", DECIDED);
        insertConsent(id(304), RETENTION, "granted", DECIDED);

        var blocked = protectedApi();
        assertThat(blocked.getStatus()).isEqualTo(403);
        JsonNode body = mapper.readTree(blocked.getContentAsString());
        assertThat(body.path("detail").textValue())
                .as("거절·철회를 따로 가르던 consent_blocked 는 없다")
                .isEqualTo("consent_required");
        assertThat(body.path("pending_consents")).extracting(document -> document.path("id").textValue())
                .containsExactly(TERMS.toString(), PRIVACY.toString());
        JsonNode entry = consentEntry();
        assertThat(entry.path("entry_status").textValue()).isEqualTo("decision_required");
        assertThat(entry.path("documents").get(0).path("current_decision").isNull()).isTrue();

        assertThat(decide(TERMS, "granted").getStatus()).isEqualTo(201);
        assertThat(decide(PRIVACY, "granted").getStatus()).isEqualTo(201);
        assertThat(protectedApi().getStatus()).as("같은 토큰으로 허용된다").isEqualTo(200);
    }

    @Test
    void accountConsent_memberWithAnUndecidedRequiredVersionCanStillWithdrawAndKeepsTheRecord()
            throws Exception {
        insertConsent(id(301), OLD_TERMS, "granted", DECIDED);
        assertThat(protectedApi().getStatus()).isEqualTo(403);

        var withdrawn = mvc.perform(delete("/v2/me").header("Authorization", bearer()))
                .andReturn().getResponse();

        assertThat(withdrawn.getStatus()).as("탈퇴는 게이트 밖이다").isLessThan(300);
        assertThat(jdbc.queryForObject("SELECT status FROM users WHERE id=?", String.class, USER_ID))
                .isEqualTo("deactivated");
        assertThat(jdbc.queryForObject(
                "SELECT count(*) FROM user_consents WHERE user_id=?", Integer.class, USER_ID))
                .as("동의의 증빙은 탈퇴해도 남는다")
                .isEqualTo(1);
    }

    /**
     * consents.py:ConsentRequest 는 extra 를 지정하지 않아 unknown key 를 <b>받는다</b>.
     * openapi.json 의 ConsentRequest 에도 additionalProperties 가 없다 —
     * apps/api/CONTRACT.md §6-3 이 허용 목록에 POST /v2/consents 를 넣은 근거다.
     */
    @Test
    void consentRequestAcceptsUnknownKeys() throws Exception {
        var response = mvc.perform(post("/v2/consents")
                        .header("Authorization", bearer())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"document_id":"%s","action":"granted","unknown":true}
                                """.formatted(TERMS)))
                .andReturn().getResponse();

        assertThat(response.getStatus()).isEqualTo(201);
    }

    private void grantRequired() {
        insertConsent(id(301), TERMS, "granted", DECIDED);
        insertConsent(id(302), PRIVACY, "granted", DECIDED);
        insertConsent(id(303), AI_ANALYSIS, "granted", DECIDED);
    }

    private MockHttpServletResponse decide(UUID documentId, String action) throws Exception {
        return mvc.perform(post("/v2/consents")
                        .header("Authorization", bearer())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"document_id\":\"" + documentId + "\",\"action\":\"" + action + "\"}"))
                .andReturn().getResponse();
    }

    /** 보호 기능 하나. 게이트를 지나면 빈 목록의 200 이다. */
    private MockHttpServletResponse protectedApi() throws Exception {
        return mvc.perform(get("/v2/practice-sessions").header("Authorization", bearer()))
                .andReturn().getResponse();
    }

    private int rows(UUID documentId, String action) {
        return jdbc.queryForObject("""
                SELECT count(*) FROM user_consents
                WHERE user_id=? AND document_id=? AND action=?
                """, Integer.class, USER_ID, documentId, action);
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
        var response = mvc.perform(get("/v2/consents/entry")
                        .header("Authorization", bearer()))
                .andReturn().getResponse();
        assertThat(response.getStatus()).isEqualTo(200);
        return mapper.readTree(response.getContentAsString());
    }

    private String bearer() {
        return "Bearer " + jwt.issueAccessToken(USER_ID).value();
    }

    private static UUID id(int suffix) {
        return UUID.fromString("00000000-0000-4000-8000-%012d".formatted(suffix));
    }
}
