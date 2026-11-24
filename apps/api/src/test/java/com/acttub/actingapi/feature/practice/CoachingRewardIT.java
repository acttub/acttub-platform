package com.acttub.actingapi.feature.practice;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.auth.app.JwtService;
import com.acttub.actingapi.feature.billing.app.AppBillingGateway;
import com.acttub.actingapi.feature.billing.app.BillingMailer;
import com.acttub.actingapi.feature.billing.app.RefundNotifier;
import com.acttub.actingapi.integration.admob.AdMobRewardVerifier;
import com.acttub.actingapi.platform.json.LenientJson;
import com.acttub.actingapi.support.AccountFixtures;
import com.acttub.actingapi.support.MutableClock;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

/**
 * 무료 코칭 한도 뒤 「광고 보고 1회 더」(SOMA-1067)를 실제 Postgres·Spring 으로 본다: 한도 소진 → 버튼 가능 → AdMob 콜백 지급
 * (같은 시청은 한 번) → 요청 id 로 확인 → 그날 네 번째 회차가 열린다 → 하루 상한. 서명 검사는 {@code AdMobRewardVerifierTest} 가
 * 보므로 여기서는 가짜로 둔다.
 */
@SpringBootTest(properties = {
        "JWT_SECRET=test-secret",
        "BILLING_WEB_ENABLED=true",
        "BILLING_WEB_RETURN_URL=https://acttub.com/pricing/result",
        "BILLING_FREE_LIMITS_ENABLED=true",
        "BILLING_LEGACY_SIGNUP_BEFORE=2000-01-01T00:00:00Z",
        "BILLING_PUBLIC_ORIGIN=https://billing.acttub.test",
        "BILLING_TOSS_CLIENT_KEY=test_ck_fakefakefake1234",
        "BILLING_TOSS_SECRET_KEY=test_sk_fakefakefake1234",
        "BILLING_RENEWAL_POLL_MS=3600000",
        "BILLING_RENEWAL_INITIAL_DELAY_MS=3600000",
        "COACHING_REWARDED_AD_ENABLED=true"})
@AutoConfigureMockMvc
@Import(MutableClock.Fixture.class)
class CoachingRewardIT {
    static final UUID USER = UUID.fromString("44444444-4444-4444-8444-444444444444");
    private static final OffsetDateTime PUBLISHED = OffsetDateTime.of(2026, 10, 1, 0, 0, 0, 0, ZoneOffset.UTC);
    private static final String TALK = "{\"request_id\":\"%s\",\"session_purpose\":\"concern\"}";

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

    @MockitoBean
    AppBillingGateway gateway;
    @MockitoBean
    BillingMailer mailer;
    @MockitoBean
    RefundNotifier refunds;
    @MockitoBean
    AdMobRewardVerifier verifier;

    private String bearer;

    @BeforeEach
    void setUp() {
        jdbc.execute("TRUNCATE TABLE users,consent_documents RESTART IDENTITY CASCADE");
        for (String type : List.of("terms", "privacy", "ai_analysis", "retention")) {
            jdbc.update("""
                    INSERT INTO consent_documents(id,type,version,title,body,required,published_at)
                    VALUES (?,?,'v1',?,?,?,?)
                    """, UUID.randomUUID(), type, type + " 제목", type + " 본문", !"retention".equals(type), PUBLISHED);
        }
        clock.set(Instant.parse("2026-10-23T01:00:00Z"));
        jdbc.update("INSERT INTO users(id,status,email) VALUES (?,'active','actor@example.com')", USER);
        jdbc.update("INSERT INTO user_identities(id,user_id,provider,provider_uid) VALUES (?,?,'google',?)",
                UUID.randomUUID(), USER, "g-" + USER);
        AccountFixtures.passGate(jdbc, USER);
        bearer = "Bearer " + jwt.issueAccessToken(USER).value();
        when(verifier.verify(any())).thenReturn(true);
    }

    @Test
    @DisplayName("한도를 다 쓰면 버튼이 열리고, 콜백 한 번에 그날 회차 1개가 더해진다 — 같은 시청은 한 번, 하루 상한 1")
    void rewardAddsOneSessionForToday() throws Exception {
        assertThat(available()).as("아직 한도가 남아 있으면 보이지 않는다").isFalse();
        for (int index = 0; index < 3; index++) {
            json(post("/v2/practices").content(TALK.formatted(UUID.randomUUID())), 201);
        }
        json(post("/v2/practices").content(TALK.formatted(UUID.randomUUID())), 429);
        assertThat(available()).isTrue();

        UUID request = UUID.randomUUID();
        assertThat(granted(request)).isFalse();
        assertThat(ssv(USER.toString(), request.toString(), "tx-1")).isEqualTo("granted");
        assertThat(ssv(USER.toString(), request.toString(), "tx-1")).as("AdMob 이 다시 보내도 한 번").isEqualTo("duplicate");
        assertThat(granted(request)).isTrue();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM coaching_rewards", Integer.class)).isEqualTo(1);
        assertThat(available()).as("오늘 상한(1)을 채웠다").isFalse();

        json(post("/v2/practices").content(TALK.formatted(UUID.randomUUID())), 201);
        json(post("/v2/practices").content(TALK.formatted(UUID.randomUUID())), 429);

        assertThat(ssv(USER.toString(), UUID.randomUUID().toString(), "tx-2")).isEqualTo("capped");
        assertThat(jdbc.queryForObject("SELECT count(*) FROM coaching_rewards", Integer.class)).isEqualTo(1);

        // 다음 날(KST)에는 보상분이 사라지고 다시 3회다.
        clock.set(Instant.parse("2026-10-23T15:00:00Z"));
        assertThat(available()).isFalse();
    }

    @Test
    @DisplayName("서명이 틀리면 403 이고 지급하지 않는다. 값이 이상하거나 Pro 면 200 ignored")
    void rejectsBadSignatureAndIgnoresStrangeValues() throws Exception {
        when(verifier.verify(any())).thenReturn(false);
        MockHttpServletResponse rejected = mvc.perform(get(ssvUrl(USER.toString(), UUID.randomUUID().toString(), "tx-9")))
                .andReturn().getResponse();
        assertThat(rejected.getStatus()).isEqualTo(403);
        assertThat(rejected.getContentAsString()).contains("invalid_signature");

        when(verifier.verify(any())).thenReturn(true);
        assertThat(ssv("actor@example.com", UUID.randomUUID().toString(), "tx-10")).isEqualTo("ignored");
        assertThat(ssv(USER.toString(), "not-a-uuid", "tx-11")).isEqualTo("ignored");
        assertThat(ssv(UUID.randomUUID().toString(), UUID.randomUUID().toString(), "tx-12")).as("없는 사람").isEqualTo("ignored");

        jdbc.update("INSERT INTO billing_pro_grants(id,user_id,starts_at,ends_at,reason) VALUES (?,?,?,?,'시험')",
                UUID.randomUUID(), USER, OffsetDateTime.parse("2026-10-01T00:00:00Z"), OffsetDateTime.parse("2026-12-01T00:00:00Z"));
        assertThat(ssv(USER.toString(), UUID.randomUUID().toString(), "tx-13")).as("Pro 는 한도 비대상").isEqualTo("ignored");
        assertThat(jdbc.queryForObject("SELECT count(*) FROM coaching_rewards", Integer.class)).isZero();
    }

    private boolean available() throws Exception {
        return json(get("/v2/coaching-rewards"), 200).path("available").booleanValue(false);
    }

    private boolean granted(UUID request) throws Exception {
        return json(get("/v2/coaching-rewards/requests/" + request), 200).path("granted").booleanValue(false);
    }

    /** 앱 토큰·앱 헤더 없이 부른다 — AdMob 서버처럼. */
    private String ssv(String userId, String customData, String transactionId) throws Exception {
        MockHttpServletResponse response = mvc.perform(get(ssvUrl(userId, customData, transactionId))).andReturn().getResponse();
        assertThat(response.getStatus()).as(response.getContentAsString()).isEqualTo(200);
        return LenientJson.asText(mapper.readTree(response.getContentAsString()).path("result"));
    }

    private static String ssvUrl(String userId, String customData, String transactionId) {
        return "/v2/coaching-rewards/ssv?ad_network=5450213213286189855&ad_unit=1234567890&custom_data=" + customData
                + "&reward_amount=1&reward_item=coaching&timestamp=1761181200000&transaction_id=" + transactionId
                + "&user_id=" + userId + "&signature=MEUCIQ&key_id=3335741209";
    }

    private JsonNode json(MockHttpServletRequestBuilder request, int status) throws Exception {
        MockHttpServletResponse response = mvc.perform(request
                        .header("Authorization", bearer)
                        .contentType(MediaType.APPLICATION_JSON))
                .andReturn()
                .getResponse();
        assertThat(response.getStatus()).as(response.getContentAsString()).isEqualTo(status);
        String body = response.getContentAsString();
        return body.isEmpty() ? mapper.nullNode() : mapper.readTree(body);
    }
}
