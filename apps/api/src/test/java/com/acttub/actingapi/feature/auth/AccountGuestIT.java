package com.acttub.actingapi.feature.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;

import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;

import com.acttub.actingapi.feature.auth.app.JwtService;
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
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

/**
 * account.guest 의 "검증 방법" 가운데 게스트 발급과 게스트의 게이트를 HTTP 와 실제 Postgres 로 본다.
 *
 * <p>리딩의 경로는 아직 서버에 없다 — "리딩부터 시작하면 둘만 나온다"는 {@code GuestGateTest} 가 기능의
 * 문서 집합으로 본다. 챌린지·포트폴리오의 경로도 아직 없어, 회원 전용은 지금 있는 경로(프로필·알림·푸시
 * 토큰·옮기기)로 본다. 웹의 시트와 브라우저 저장소는 웹 갈래의 테스트가 본다.
 */
@SpringBootTest(properties = {"JWT_SECRET=test-secret", "ACCOUNT_CLEANUP_ENABLED=false"})
@AutoConfigureMockMvc
@Import(MutableClock.Fixture.class)
class AccountGuestIT {
    private static final AtomicInteger ADDRESSES = new AtomicInteger();
    private static final OffsetDateTime PUBLISHED = OffsetDateTime.of(2026, 10, 1, 0, 0, 0, 0, ZoneOffset.UTC);

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        String name = PostgresContainerSupport.createDatabaseName("account_guest");
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

    private final Map<String, UUID> documents = new LinkedHashMap<>();
    private String address;

    @BeforeEach
    void setUp() {
        jdbc.execute("TRUNCATE TABLE users,consent_documents RESTART IDENTITY CASCADE");
        documents.clear();
        for (String type : List.of("terms", "privacy", "ai_analysis", "retention")) {
            UUID id = UUID.randomUUID();
            documents.put(type, id);
            jdbc.update("""
                    INSERT INTO consent_documents(id,type,version,title,body,required,published_at)
                    VALUES (?,?,'v1',?,?,?,?)
                    """, id, type, type + " 제목", type + " 본문", !"retention".equals(type), PUBLISHED);
        }
        address = "10.5.0." + ADDRESSES.incrementAndGet();
        clock.set(Instant.now().truncatedTo(java.time.temporal.ChronoUnit.SECONDS));
    }

    @Test
    @DisplayName("account.guest: 랜딩과 동의 문서 페이지를 열어도 users 행이 생기지 않는다. 연습 시작을 누르면 users 행과 provider=guest 신원이 생기고 리프레시 토큰을 받는다")
    void accountGuest_aGuestExistsOnlyOnceAProtectedFeatureIsWanted() throws Exception {
        assertThat(mvc.perform(get("/v2/consents/documents")).andReturn().getResponse().getStatus()).isEqualTo(200);
        assertThat(mvc.perform(get("/v2/admissions")).andReturn().getResponse().getStatus()).isEqualTo(200);
        assertThat(count("users")).isZero();

        var response = createGuest();

        assertThat(response.getStatus()).isEqualTo(201);
        JsonNode body = mapper.readTree(response.getContentAsString());
        assertThat(body.fieldNames()).toIterable().containsExactlyInAnyOrder(
                "access_token", "refresh_token", "token_type", "expires_in", "user", "account_type");
        assertThat(body.path("account_type").textValue()).isEqualTo("guest");
        assertThat(body.path("token_type").textValue()).isEqualTo("bearer");
        assertThat(body.path("expires_in").longValue()).isEqualTo(1800);
        assertThat(body.path("user").path("email").isNull()).isTrue();
        assertThat(body.path("user").path("status").textValue()).isEqualTo("active");
        UUID guestId = UUID.fromString(body.path("user").path("id").textValue());

        assertThat(count("users")).isEqualTo(1);
        Map<String, Object> identity = jdbc.queryForMap(
                "SELECT provider,provider_uid FROM user_identities WHERE user_id=?", guestId);
        assertThat(identity).containsEntry("provider", "guest");
        assertThat((String) identity.get("provider_uid")).as("추측할 수 없는 난수").hasSizeGreaterThanOrEqualTo(32);
        assertThat(jdbc.queryForObject(
                "SELECT count(*) FROM refresh_tokens WHERE user_id=? AND revoked_at IS NULL", Integer.class, guestId))
                .isEqualTo(1);
        assertThat(count("user_profiles")).as("게스트에게는 프로필이 없다").isZero();

        JsonNode me = json(authorized(get("/v2/me"), body.path("access_token").textValue()), 200);
        assertThat(me.path("account_type").textValue()).isEqualTo("guest");

        JsonNode refreshed = json(mvc.perform(post("/v2/auth/refresh")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"refresh_token\":\"" + body.path("refresh_token").textValue() + "\"}")), 200);
        assertThat(refreshed.path("access_token").textValue()).as("갱신은 회원과 같다").isNotBlank();
    }

    @Test
    @DisplayName("account.guest: 끝난 게스트의 토큰을 아직 붙이고 있는 웹이 새 게스트를 만들어도 401 로 막히지 않는다")
    void accountGuest_creatingAGuestIgnoresAStaleToken() throws Exception {
        var response = mvc.perform(post("/v2/auth/guest")
                        .with(request -> {
                            request.setRemoteAddr(address);
                            return request;
                        })
                        .header("Authorization", "Bearer expired.token.value"))
                .andReturn().getResponse();

        assertThat(response.getStatus()).isEqualTo(201);
    }

    @Test
    @DisplayName("account.guest: 새 게스트의 분석 요청 — 403 과 빠진 문서 셋. 셋에 동의하면 프로필 입력 없이 허용된다")
    void accountGuest_practiceAsksForItsThreeDocumentsAndNoProfile() throws Exception {
        String token = guestToken();

        var blocked = authorized(get("/v2/practice-sessions"), token).andReturn().getResponse();

        assertThat(blocked.getStatus()).isEqualTo(403);
        JsonNode body = mapper.readTree(blocked.getContentAsString());
        assertThat(body.path("detail").textValue()).isEqualTo("consent_required");
        assertThat(body.path("pending_consents")).extracting(document -> document.path("type").textValue())
                .as("선택 문서는 게스트에게 묻지 않는다")
                .containsExactly("terms", "privacy", "ai_analysis");
        assertThat(body.path("pending_consents").get(0).fieldNames()).toIterable().containsExactlyInAnyOrder(
                "id", "type", "version", "title", "body", "required", "published_at");

        consent(token, "terms", true);
        consent(token, "privacy", null);
        JsonNode partly = mapper.readTree(
                authorized(get("/v2/practice-sessions"), token).andReturn().getResponse().getContentAsString());
        assertThat(partly.path("pending_consents")).extracting(document -> document.path("type").textValue())
                .as("그 기능에 빠진 문서만 싣는다")
                .containsExactly("ai_analysis");

        consent(token, "ai_analysis", null);

        JsonNode list = json(authorized(get("/v2/practice-sessions"), token), 200);
        assertThat(list.path("sessions")).isEmpty();
        assertThat(count("user_profiles")).isZero();
    }

    @Test
    @DisplayName("account.guest: 확인 없이 동의 API 를 부르면 422. 확인하고 동의하면 users.age_confirmed_at 이 차고, 그 뒤로는 다시 싣지 않아도 된다")
    void accountGuest_theFirstConsentNeedsTheAgeConfirmation() throws Exception {
        JsonNode guest = mapper.readTree(createGuest().getContentAsString());
        String token = guest.path("access_token").textValue();
        UUID guestId = UUID.fromString(guest.path("user").path("id").textValue());

        var unconfirmed = postConsent(token, "terms", null);
        var denied = postConsent(token, "terms", false);

        for (var response : List.of(unconfirmed, denied)) {
            assertThat(response.getStatus()).isEqualTo(422);
            assertThat(mapper.readTree(response.getContentAsString()))
                    .isEqualTo(mapper.readTree("{\"detail\":\"age_confirmation_required\"}"));
        }
        assertThat(count("user_consents")).isZero();
        assertThat(jdbc.queryForObject("SELECT age_confirmed_at FROM users WHERE id=?",
                java.sql.Timestamp.class, guestId)).isNull();

        assertThat(postConsent(token, "terms", true).getStatus()).isEqualTo(201);

        java.sql.Timestamp confirmedAt = jdbc.queryForObject(
                "SELECT age_confirmed_at FROM users WHERE id=?", java.sql.Timestamp.class, guestId);
        assertThat(confirmedAt).isNotNull();

        clock.advance(Duration.ofMinutes(5));
        assertThat(postConsent(token, "privacy", null).getStatus()).isEqualTo(201);
        assertThat(jdbc.queryForObject("SELECT age_confirmed_at FROM users WHERE id=?",
                java.sql.Timestamp.class, guestId)).as("처음 확인한 시각 그대로다").isEqualTo(confirmedAt);
    }

    @Test
    @DisplayName("account.guest: 회원의 동의에는 나이 확인 줄이 없다 — 회원은 생년월일로 거른다")
    void accountGuest_membersAreNeverAskedToConfirmTheirAge() throws Exception {
        UUID member = member();

        var response = postConsent(jwt.issueAccessToken(member).value(), "retention", null);

        assertThat(response.getStatus()).isIn(200, 201);
    }

    @Test
    @DisplayName("account.guest: 선택 문서는 회원에게만 묻는다 — 게스트의 미결정 목록과 동의 현황에 없고, 결정을 보내면 403 member_only 다")
    void accountGuest_optionalDocumentsAreNeverPutToAGuest() throws Exception {
        String token = guestToken();
        consent(token, "terms", true);
        consent(token, "privacy", null);

        JsonNode pending = json(authorized(get("/v2/consents/pending"), token), 200);
        JsonNode entry = json(authorized(get("/v2/consents/entry"), token), 200);
        var retention = postConsent(token, "retention", null);

        assertThat(pending.path("documents")).extracting(document -> document.path("type").textValue())
                .containsExactly("ai_analysis");
        assertThat(entry.path("documents")).extracting(document -> document.path("type").textValue())
                .containsExactly("terms", "privacy", "ai_analysis");
        assertThat(retention.getStatus()).isEqualTo(403);
        assertThat(mapper.readTree(retention.getContentAsString()))
                .isEqualTo(mapper.readTree("{\"detail\":\"member_only\"}"));
    }

    @Test
    @DisplayName("account.guest: 게스트 토큰으로 동의 현황을 읽는다 — privacy 행에 현재 판의 결정이 실린다(웹 계측의 단일 기준)")
    void accountGuest_consentEntryIsOpenToGuestsAndFollowsTheCurrentVersion() throws Exception {
        String token = guestToken();

        JsonNode before = json(authorized(get("/v2/consents/entry"), token), 200);
        assertThat(privacyDecision(before).isNull()).isTrue();

        consent(token, "privacy", true);
        assertThat(privacyDecision(json(authorized(get("/v2/consents/entry"), token), 200)).textValue())
                .isEqualTo("granted");

        jdbc.update("""
                INSERT INTO consent_documents(id,type,version,title,body,required,published_at)
                VALUES (?,'privacy','v2','수집·이용 동의','새 수집',true,?)
                """, UUID.randomUUID(), PUBLISHED.plusDays(30));
        assertThat(privacyDecision(json(authorized(get("/v2/consents/entry"), token), 200)).isNull())
                .as("옛 판의 동의로는 새 판의 수집을 켜지 않는다")
                .isTrue();
    }

    @Test
    @DisplayName("account.guest: 한 IP 에서 한 시간에 게스트 11개 — 열한 번째는 429")
    void accountGuest_anIpMakesTenGuestsAnHour() throws Exception {
        for (int created = 0; created < 10; created++) {
            assertThat(createGuest().getStatus()).isEqualTo(201);
        }

        var eleventh = createGuest();

        assertThat(eleventh.getStatus()).isEqualTo(429);
        assertThat(mapper.readTree(eleventh.getContentAsString()))
                .isEqualTo(mapper.readTree("{\"detail\":\"rate limit exceeded\"}"));
        assertThat(count("users")).isEqualTo(10);
    }

    @Test
    @DisplayName("account.guest: 한 게스트가 하루 4번째 분석 — 429. 한국 시간 자정이 지나면 다시 된다")
    void accountGuest_aGuestGetsThreeAnalysesAKoreanDay() throws Exception {
        // 한국 시간 23시에서 시작한다. 한 시간 뒤가 자정이다.
        clock.set(Instant.now().atZone(ZoneId.of("Asia/Seoul")).toLocalDate().atTime(23, 0)
                .atZone(ZoneId.of("Asia/Seoul")).toInstant());
        JsonNode guest = mapper.readTree(createGuest().getContentAsString());
        String token = guest.path("access_token").textValue();
        UUID guestId = UUID.fromString(guest.path("user").path("id").textValue());
        consent(token, "terms", true);
        consent(token, "privacy", null);
        consent(token, "ai_analysis", null);
        UUID session = practice(guestId);
        for (int analysis = 0; analysis < 3; analysis++) {
            jdbc.update("""
                    INSERT INTO external_operations(id,session_id,user_id,request_id,kind,status,request_fingerprint,created_at)
                    VALUES (?,?,?,?,'analyze','succeeded',?,?)
                    """, UUID.randomUUID(), session, guestId, UUID.randomUUID(), "a".repeat(64),
                    clock.instant().minusSeconds(60L * (analysis + 1)).atOffset(ZoneOffset.UTC));
        }

        var fourth = authorized(post("/v2/practice-sessions/{id}/analyze", session), token).andReturn().getResponse();

        assertThat(fourth.getStatus()).isEqualTo(429);
        assertThat(mapper.readTree(fourth.getContentAsString()))
                .isEqualTo(mapper.readTree("{\"detail\":\"guest_daily_analysis_limit\"}"));

        clock.advance(Duration.ofMinutes(61));

        var nextDay = authorized(post("/v2/practice-sessions/{id}/analyze", session), token).andReturn().getResponse();
        assertThat(nextDay.getStatus()).as("자정이 지나면 한도에 걸리지 않는다(실패한 분석이 아니라 409)").isEqualTo(409);
        assertThat(mapper.readTree(nextDay.getContentAsString()).path("detail").textValue())
                .isEqualTo("session_is_not_failed");
    }

    @Test
    @DisplayName("account.guest: 하루 3회는 게스트에게만 걸린다 — 회원은 네 번째 분석도 한도에 걸리지 않는다")
    void accountGuest_theDailyLimitIsOnlyForGuests() throws Exception {
        UUID member = member();
        UUID session = practice(member);
        for (int analysis = 0; analysis < 3; analysis++) {
            jdbc.update("""
                    INSERT INTO external_operations(id,session_id,user_id,request_id,kind,status,request_fingerprint)
                    VALUES (?,?,?,?,'analyze','succeeded',?)
                    """, UUID.randomUUID(), session, member, UUID.randomUUID(), "a".repeat(64));
        }

        var fourth = authorized(post("/v2/practice-sessions/{id}/analyze", session),
                jwt.issueAccessToken(member).value()).andReturn().getResponse();

        assertThat(fourth.getStatus()).isEqualTo(409);
    }

    @Test
    @DisplayName("account.guest: 게스트가 회원 전용 기능(프로필·알림·푸시 토큰·옮기기)을 부르면 403 member_only, 회원 토큰으로 이관 코드 발급은 403 guest_only")
    void accountGuest_memberOnlyAndGuestOnlyFeatures() throws Exception {
        String guest = guestToken();
        consent(guest, "terms", true);
        consent(guest, "privacy", null);
        consent(guest, "ai_analysis", null);

        List<MockHttpServletResponse> memberOnly = List.of(
                authorized(put("/v2/me/profile").contentType(MediaType.APPLICATION_JSON).content("""
                        {"name":"김배우","gender":"female","birth_date":"2001-03-14","directions":["media"],
                         "experience":"exam_prep","goal":"audition"}
                        """), guest).andReturn().getResponse(),
                authorized(get("/v2/me/notification-settings"), guest).andReturn().getResponse(),
                authorized(post("/v2/push-tokens").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"token\":\"ExponentPushToken[guest]\",\"platform\":\"ios\"}"), guest)
                        .andReturn().getResponse(),
                authorized(post("/v2/guest-transfers").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"code\":\"123456\"}"), guest).andReturn().getResponse());

        for (var response : memberOnly) {
            assertThat(response.getStatus()).as(response.getContentAsString()).isEqualTo(403);
            assertThat(mapper.readTree(response.getContentAsString()))
                    .isEqualTo(mapper.readTree("{\"detail\":\"member_only\"}"));
        }
        assertThat(count("push_tokens")).isZero();

        var guestOnly = authorized(post("/v2/guest/transfer-code"), jwt.issueAccessToken(member()).value())
                .andReturn().getResponse();
        assertThat(guestOnly.getStatus()).isEqualTo(403);
        assertThat(mapper.readTree(guestOnly.getContentAsString()))
                .isEqualTo(mapper.readTree("{\"detail\":\"guest_only\"}"));
        assertThat(count("guest_transfer_codes")).isZero();
    }

    // ---- helpers ----

    private MockHttpServletResponse createGuest() throws Exception {
        return mvc.perform(post("/v2/auth/guest").with(request -> {
            request.setRemoteAddr(address);
            return request;
        })).andReturn().getResponse();
    }

    private String guestToken() throws Exception {
        return mapper.readTree(createGuest().getContentAsString()).path("access_token").textValue();
    }

    private UUID member() {
        UUID member = UUID.randomUUID();
        jdbc.update("INSERT INTO users(id,status) VALUES (?,'active')", member);
        jdbc.update("INSERT INTO user_identities(id,user_id,provider,provider_uid) VALUES (?,?,'google',?)",
                UUID.randomUUID(), member, "g-" + member);
        AccountFixtures.passGate(jdbc, member);
        return member;
    }

    private UUID practice(UUID owner) {
        UUID upload = UUID.randomUUID();
        UUID session = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO upload_intents(id,user_id,status,storage_provider,object_key,mime_type,size_bytes,expires_at,finalized_at)
                VALUES (?,?,'finalized','s3',?,'video/mp4',100,now() + interval '1 hour',now())
                """, upload, owner, "videos/" + upload + ".mp4");
        jdbc.update("""
                INSERT INTO practice_sessions(id,user_id,upload_intent_id,status,situation,character_context,blockage_kind,sub_branch,goal)
                VALUES (?,?,?,'analyzed','상황','인물','분석','캐릭터 분석','목표')
                """, session, owner, upload);
        return session;
    }

    private void consent(String token, String type, Boolean ageConfirmed) throws Exception {
        var response = postConsent(token, type, ageConfirmed);
        assertThat(response.getStatus()).as(response.getContentAsString()).isEqualTo(201);
    }

    private MockHttpServletResponse postConsent(String token, String type, Boolean ageConfirmed) throws Exception {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("document_id", documents.get(type).toString());
        body.put("action", "granted");
        if (ageConfirmed != null) {
            body.put("age_confirmed", ageConfirmed);
        }
        return authorized(post("/v2/consents").contentType(MediaType.APPLICATION_JSON)
                .content(mapper.writeValueAsString(body)), token).andReturn().getResponse();
    }

    private static JsonNode privacyDecision(JsonNode entry) {
        for (JsonNode document : entry.path("documents")) {
            if ("privacy".equals(document.path("type").textValue())) {
                return document.path("current_decision");
            }
        }
        throw new AssertionError("동의 현황에 privacy 행이 없다: " + entry);
    }

    private org.springframework.test.web.servlet.ResultActions authorized(
            MockHttpServletRequestBuilder request, String token) throws Exception {
        return mvc.perform(request.header("Authorization", "Bearer " + token));
    }

    private JsonNode json(org.springframework.test.web.servlet.ResultActions actions, int status) throws Exception {
        var response = actions.andReturn().getResponse();
        assertThat(response.getStatus()).as(response.getContentAsString()).isEqualTo(status);
        return mapper.readTree(response.getContentAsString());
    }

    private int count(String table) {
        return jdbc.queryForObject("SELECT count(*) FROM " + table, Integer.class);
    }
}
