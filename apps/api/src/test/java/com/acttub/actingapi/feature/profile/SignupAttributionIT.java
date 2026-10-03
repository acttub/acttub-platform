package com.acttub.actingapi.feature.profile;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import com.acttub.actingapi.feature.auth.app.JwtService;
import com.acttub.actingapi.feature.profile.app.ProfileService;
import com.acttub.actingapi.support.AccountFixtures;
import com.acttub.actingapi.support.PostgresContainerSupport;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;

/**
 * 가입 계정의 유입 광고(SOMA-588) — {@code PUT /v2/me/signup-attribution} 을 HTTP 와 실제 Postgres 로 본다.
 * 처음 온 값만 남는지, 값 규칙이 422 로 막히는지, 탈퇴가 기록을 지우는지.
 */
@SpringBootTest(properties = {
    "JWT_SECRET=test-secret",
    "ACCOUNT_CLEANUP_ENABLED=false",
    "ADMIN_OPS_TOKEN=admin-secret",
    "ADMIN_OPS_EXCLUDE_EMAILS=team@acttub.com"
})
@AutoConfigureMockMvc
class SignupAttributionIT {

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        String name = PostgresContainerSupport.createDatabaseName("signup_attribution");
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
    ProfileService profiles;

    @Autowired
    ObjectMapper mapper;

    private UUID member;
    private UUID privacyDocument;
    private String bearer;

    @BeforeEach
    void setUp() {
        jdbc.execute("TRUNCATE TABLE users,consent_documents RESTART IDENTITY CASCADE");
        OffsetDateTime publishedAt = OffsetDateTime.of(2026, 10, 1, 0, 0, 0, 0, ZoneOffset.UTC);
        jdbc.update("""
                INSERT INTO consent_documents(id,type,version,title,body,required,published_at)
                VALUES (?,'terms','v1','약관','본문',true,?)
                """, UUID.randomUUID(), publishedAt);
        privacyDocument = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO consent_documents(id,type,version,title,body,required,published_at)
                VALUES (?,'privacy','v1','개인정보 수집·이용','본문',true,?)
                """, privacyDocument, publishedAt);
        member = UUID.randomUUID();
        jdbc.update("INSERT INTO users(id,status) VALUES (?,'active')", member);
        jdbc.update("INSERT INTO user_identities(id,user_id,provider,provider_uid) VALUES (?,?,'google',?)",
                UUID.randomUUID(), member, "g-" + member);
        AccountFixtures.passGate(jdbc, member);
        bearer = "Bearer " + jwt.issueAccessToken(member).value();
    }

    @Test
    @DisplayName("처음 온 유입 광고만 남는다 — 다시 보내도 204 이고 첫 값이 그대로다")
    void firstAttributionWinsAndRetriesAreHarmless() throws Exception {
        assertThat(record("""
                {"source":"airbridge","platform":"ios","channel":"facebook.business",
                 "campaign":"ACTTUB | iOS 앱 설치 릴스","ad_group":"iOS 앱 설치 | 연기",
                 "ad_creative":"대사분석 릴스 | iOS 앱 설치","content":null,"term":null,"sub_publisher":null}
                """).getStatus()).isEqualTo(204);
        assertThat(record("""
                {"source":"airbridge","platform":"android","channel":"unattributed"}
                """).getStatus()).isEqualTo(204);

        List<Map<String, Object>> rows = jdbc.queryForList(
                "SELECT platform,channel,campaign,ad_group,ad_creative,content FROM user_signup_attributions WHERE user_id=?",
                member);
        assertThat(rows).hasSize(1);
        assertThat(rows.getFirst())
                .containsEntry("platform", "ios")
                .containsEntry("channel", "facebook.business")
                .containsEntry("campaign", "ACTTUB | iOS 앱 설치 릴스")
                .containsEntry("ad_group", "iOS 앱 설치 | 연기")
                .containsEntry("ad_creative", "대사분석 릴스 | iOS 앱 설치")
                .containsEntry("content", null);
    }

    @Test
    @DisplayName("앞뒤 공백은 걷고, 빈 선택 값은 NULL 로 적는다")
    void blankOptionalValuesAreStoredAsNull() throws Exception {
        assertThat(record("""
                {"source":"airbridge","platform":"android","channel":"  unattributed  ","campaign":"   "}
                """).getStatus()).isEqualTo(204);

        Map<String, Object> row = jdbc.queryForMap(
                "SELECT channel,campaign FROM user_signup_attributions WHERE user_id=?", member);
        assertThat(row).containsEntry("channel", "unattributed").containsEntry("campaign", null);
    }

    @Test
    @DisplayName("웹 게스트는 현재 privacy 동의 뒤 프로필 없이 저장하고, 앱 회원 경로는 계속 member_only다")
    void webGuestRequiresCurrentPrivacyButNotAProfile() throws Exception {
        UUID guest = guest(false);
        String guestBearer = "Bearer " + jwt.issueAccessToken(guest).value();

        MockHttpServletResponse beforeConsent = recordWeb("""
                {"channel":"instagram","medium":"paid_social"}
                """, guestBearer);
        assertThat(beforeConsent.getStatus()).isEqualTo(403);
        assertThat(mapper.readTree(beforeConsent.getContentAsString()).path("detail").asText())
                .isEqualTo("consent_required");

        grantPrivacy(guest);
        assertThat(recordWeb("""
                {"channel":"  instagram  ","medium":"  paid_social  ","campaign":"   ",
                 "content":"reel_1","term":null}
                """, guestBearer).getStatus()).isEqualTo(204);

        assertThat(jdbc.queryForMap("""
                SELECT source,platform,channel,medium,campaign,content,term
                FROM user_signup_attributions WHERE user_id=?
                """, guest))
                .containsEntry("source", "web_utm")
                .containsEntry("platform", "web")
                .containsEntry("channel", "instagram")
                .containsEntry("medium", "paid_social")
                .containsEntry("campaign", null)
                .containsEntry("content", "reel_1")
                .containsEntry("term", null);

        assertThat(mvc.perform(put("/v2/me/signup-attribution")
                        .header("Authorization", guestBearer)
                        .header("X-Acttub-Client", "app/0.1.2")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"source":"airbridge","platform":"ios","channel":"unattributed"}
                                """))
                .andReturn().getResponse().getStatus()).isEqualTo(403);
    }

    @Test
    @DisplayName("privacy 새 판이 발행되면 옛 동의로 웹 유입을 저장할 수 없다")
    void webAttributionRequiresTheCurrentPrivacyVersion() throws Exception {
        UUID guest = guest(true);
        String guestBearer = "Bearer " + jwt.issueAccessToken(guest).value();
        jdbc.update("""
                INSERT INTO consent_documents(id,type,version,title,body,required,published_at)
                VALUES (?,'privacy','v2','개인정보 수집·이용','새 본문',true,?)
                """, UUID.randomUUID(), OffsetDateTime.of(2026, 10, 2, 0, 0, 0, 0, ZoneOffset.UTC));

        MockHttpServletResponse response = recordWeb("{\"channel\":\"instagram\"}", guestBearer);

        assertThat(response.getStatus()).isEqualTo(403);
        assertThat(mapper.readTree(response.getContentAsString()).path("detail").asText())
                .isEqualTo("consent_required");
        assertThat(count(guest)).isZero();
    }

    @Test
    @DisplayName("웹 UTM은 최초 안전 토큰만 남고 재시도·다른 값은 바꾸지 않는다")
    void firstSafeWebAttributionWins() throws Exception {
        UUID guest = guest(true);
        String guestBearer = "Bearer " + jwt.issueAccessToken(guest).value();

        assertThat(recordWeb("""
                {"channel":"instagram","medium":"paid_social","campaign":"actor_launch"}
                """, guestBearer).getStatus()).isEqualTo(204);
        assertThat(recordWeb("""
                {"channel":"google","medium":"cpc","campaign":"later"}
                """, guestBearer).getStatus()).isEqualTo(204);

        assertThat(jdbc.queryForMap("""
                SELECT source,platform,channel,medium,campaign
                FROM user_signup_attributions WHERE user_id=?
                """, guest))
                .containsEntry("source", "web_utm")
                .containsEntry("platform", "web")
                .containsEntry("channel", "instagram")
                .containsEntry("medium", "paid_social")
                .containsEntry("campaign", "actor_launch");
    }

    @Test
    @DisplayName("웹 UTM의 공백 필수값·과도 길이·URL·개인식별 모양·모르는 키는 422다")
    void unsafeWebValuesAreRejected() throws Exception {
        UUID guest = guest(true);
        String guestBearer = "Bearer " + jwt.issueAccessToken(guest).value();

        assertThat(recordWeb("{\"channel\":\"   \"}", guestBearer).getStatus()).isEqualTo(422);
        assertThat(recordWeb("""
                {"channel":"instagram","campaign":"%s"}
                """.formatted("a".repeat(65)), guestBearer).getStatus()).isEqualTo(422);
        assertThat(recordWeb("""
                {"channel":"https://example.com/path"}
                """, guestBearer).getStatus()).isEqualTo(422);
        assertThat(recordWeb("""
                {"channel":"person@example.com"}
                """, guestBearer).getStatus()).isEqualTo(422);
        assertThat(recordWeb("""
                {"channel":"instagram","source":"web_utm"}
                """, guestBearer).getStatus()).isEqualTo(422);

        assertThat(count(guest)).isZero();
    }

    @Test
    @DisplayName("값 규칙을 어기면 422 이고 아무것도 적지 않는다")
    void invalidValuesAreRejected() throws Exception {
        assertThat(record("""
                {"source":"airbridge","platform":"web","channel":"facebook.business"}
                """).getStatus()).isEqualTo(422);
        assertThat(record("""
                {"source":"airbridge","platform":"ios","channel":"   "}
                """).getStatus()).isEqualTo(422);
        assertThat(record("""
                {"source":"appsflyer","platform":"ios","channel":"facebook.business"}
                """).getStatus()).isEqualTo(422);
        assertThat(record("""
                {"source":"airbridge","platform":"ios","channel":"facebook.business","campaign":"%s"}
                """.formatted("가".repeat(201))).getStatus()).isEqualTo(422);
        assertThat(record("""
                {"source":"airbridge","platform":"ios","channel":"facebook.business","idfa":"x"}
                """).getStatus()).as("광고 식별자 같은 모르는 키는 받지 않는다").isEqualTo(422);

        assertThat(count()).isZero();
    }

    @Test
    @DisplayName("DB도 source/platform 조합과 웹 안전 문자열을 거절한다")
    void databaseRejectsInvalidCombinationsAndUnsafeWebValues() {
        assertThatThrownBy(() -> jdbc.update("""
                INSERT INTO user_signup_attributions(user_id,source,platform,channel)
                VALUES (?,'web_utm','ios','instagram')
                """, member)).hasMessageContaining("ck_user_signup_attributions_source_platform");
        assertThatThrownBy(() -> jdbc.update("""
                INSERT INTO user_signup_attributions(user_id,source,platform,channel)
                VALUES (?,'airbridge','web','unattributed')
                """, member)).hasMessageContaining("ck_user_signup_attributions_source_platform");
        assertThatThrownBy(() -> jdbc.update("""
                INSERT INTO user_signup_attributions(user_id,source,platform,channel)
                VALUES (?,'web_utm','web','https://example.com')
                """, member)).hasMessageContaining("ck_user_signup_attributions_web_values");
        assertThat(count()).isZero();
    }

    @Test
    @DisplayName("탈퇴하면 유입 기록을 행째 지우고, 탈퇴한 계정에는 다시 적지 않는다")
    void withdrawalErasesTheAttribution() throws Exception {
        assertThat(record("""
                {"source":"airbridge","platform":"ios","channel":"facebook.business"}
                """).getStatus()).isEqualTo(204);

        profiles.withdraw(member);

        assertThat(count()).isZero();
        assertThat(record("""
                {"source":"airbridge","platform":"ios","channel":"facebook.business"}
                """).getStatus()).isEqualTo(403);
        assertThat(count()).isZero();
    }

    @Test
    @DisplayName("ops-core 는 가명과 광고 이름만 싣고 팀 계정은 뺀다")
    void opsCoreListsAttributionsByPseudonymWithoutTheTeam() throws Exception {
        assertThat(record("""
                {"source":"airbridge","platform":"ios","channel":"facebook.business",
                 "campaign":"ACTTUB | iOS 앱 설치 릴스","ad_group":"iOS 앱 설치 | 연기","ad_creative":"대사분석 릴스"}
                """).getStatus()).isEqualTo(204);
        UUID team = UUID.randomUUID();
        jdbc.update("INSERT INTO users(id,email,status) VALUES (?,'team@acttub.com','active')", team);
        jdbc.update("""
                INSERT INTO user_signup_attributions(user_id,source,platform,channel)
                VALUES (?,'airbridge','android','unattributed')
                """, team);

        var response = mvc.perform(get("/v2/admin/ops-core").header("Authorization", "Bearer admin-secret"))
                .andReturn().getResponse();
        assertThat(response.getStatus()).isEqualTo(200);
        JsonNode rows = mapper.readTree(response.getContentAsString()).path("signup_attributions");

        assertThat(rows.isArray()).isTrue();
        assertThat(rows).hasSize(1);
        JsonNode row = rows.get(0);
        assertThat(row.fieldNames()).toIterable().containsExactly(
                "actor", "signup_at", "source", "platform", "channel", "medium", "campaign", "ad_group", "ad_creative");
        assertThat(row.path("actor").asText()).isEqualTo("배우 " + md5(member.toString()).substring(0, 8));
        assertThat(row.path("source").asText()).isEqualTo("airbridge");
        assertThat(row.path("platform").asText()).isEqualTo("ios");
        assertThat(row.path("medium").isNull()).isTrue();
        assertThat(row.path("campaign").asText()).isEqualTo("ACTTUB | iOS 앱 설치 릴스");
        assertThat(row.path("signup_at").asText()).matches("\\d{4}-\\d{2}-\\d{2}T\\d{2}:00:00\\.000000Z");
    }

    private static String md5(String value) throws Exception {
        return HexFormat.of().formatHex(
                MessageDigest.getInstance("MD5").digest(value.getBytes(StandardCharsets.UTF_8)));
    }

    private UUID guest(boolean privacyGranted) {
        UUID guest = UUID.randomUUID();
        jdbc.update("INSERT INTO users(id,status) VALUES (?,'active')", guest);
        jdbc.update("INSERT INTO user_identities(id,user_id,provider,provider_uid) VALUES (?,?,'guest',?)",
                UUID.randomUUID(), guest, "guest-" + guest);
        if (privacyGranted) {
            grantPrivacy(guest);
        }
        return guest;
    }

    private void grantPrivacy(UUID userId) {
        jdbc.update("""
                INSERT INTO user_consents(id,user_id,document_id,action,occurred_at)
                VALUES (?,?,?,'granted',now())
                """, UUID.randomUUID(), userId, privacyDocument);
    }

    private MockHttpServletResponse recordWeb(String body, String authorization) throws Exception {
        return mvc.perform(put("/v2/me/web-attribution")
                        .header("Authorization", authorization)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andReturn().getResponse();
    }

    private MockHttpServletResponse record(String body) throws Exception {
        return mvc.perform(put("/v2/me/signup-attribution")
                        .header("Authorization", bearer)
                        .header("X-Acttub-Client", "app/0.1.2")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andReturn().getResponse();
    }

    private int count() {
        return count(member);
    }

    private int count(UUID userId) {
        Integer count = jdbc.queryForObject(
                "SELECT count(*) FROM user_signup_attributions WHERE user_id=?", Integer.class, userId);
        return count == null ? 0 : count;
    }
}
