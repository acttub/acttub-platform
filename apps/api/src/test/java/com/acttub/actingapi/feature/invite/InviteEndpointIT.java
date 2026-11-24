package com.acttub.actingapi.feature.invite;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.auth.app.JwtService;
import com.acttub.actingapi.feature.reading.app.SessionRepository.ProgressChange;
import com.acttub.actingapi.feature.reading.app.SessionService;
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
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

/**
 * 친구 초대(SOMA-865)를 실제 Postgres·Spring 으로 본다: 코드 발급, 넣기 규칙(본인·한 번·7일·없는 코드·탈퇴한 초대자),
 * 리딩 완료로 이어지는 지급(둘 다 Pro 1개월, 한 번만), 초대자 월 상한, 결제 구독을 건드리지 않음.
 */
@SpringBootTest(properties = {
        "JWT_SECRET=test-secret",
        "INVITE_ENABLED=true",
        "INVITE_INVITER_MONTHLY_CAP=1",
        "INVITE_REDEEM_WINDOW_DAYS=7"})
@AutoConfigureMockMvc
@Import(MutableClock.Fixture.class)
class InviteEndpointIT {
    private static final UUID INVITER = UUID.fromString("11111111-1111-4111-8111-111111111111");
    private static final UUID FRIEND = UUID.fromString("22222222-2222-4222-8222-222222222222");
    private static final UUID SECOND = UUID.fromString("33333333-3333-4333-8333-333333333333");
    private static final UUID OLD = UUID.fromString("44444444-4444-4444-8444-444444444444");
    private static final Instant NOW = Instant.parse("2026-11-24T03:00:00Z");

    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate jdbc;
    @Autowired ObjectMapper mapper;
    @Autowired JwtService jwt;
    @Autowired MutableClock clock;
    @Autowired SessionService sessions;

    @BeforeEach
    void setUp() {
        jdbc.execute("TRUNCATE TABLE users,consent_documents RESTART IDENTITY CASCADE");
        for (String type : List.of("terms", "privacy", "ai_analysis", "retention")) {
            jdbc.update("""
                    INSERT INTO consent_documents(id,type,version,title,body,required,published_at)
                    VALUES (?,?,'v1',?,?,?,?)
                    """, UUID.randomUUID(), type, type + " 제목", type + " 본문", !"retention".equals(type),
                    OffsetDateTime.of(2026, 10, 1, 0, 0, 0, 0, ZoneOffset.UTC));
        }
        clock.set(NOW);
        member(INVITER, "2026-10-01T00:00:00Z");
        member(FRIEND, "2026-11-23T00:00:00Z");
        member(SECOND, "2026-11-22T00:00:00Z");
        member(OLD, "2026-11-10T00:00:00Z");
    }

    @Test
    @DisplayName("내 코드는 한 번 만들어 계속 같고, 0·O·1·I 가 없는 6자리다. 가입 7일이 지난 사람은 넣기 칸이 닫혀 있다")
    void codeIsStableAndWindowShows() throws Exception {
        JsonNode first = json(INVITER, get("/v2/invite/me"), 200);
        String code = first.path("code").stringValue(null);
        assertThat(code).matches("[A-HJ-NP-Z2-9]{6}");
        assertThat(json(INVITER, get("/v2/invite/me"), 200).path("code").stringValue(null)).isEqualTo(code);
        assertThat(first.path("can_redeem").booleanValue(true)).isFalse();
        assertThat(first.path("redeem_until").isNull()).isTrue();

        JsonNode friend = json(FRIEND, get("/v2/invite/me"), 200);
        assertThat(friend.path("can_redeem").booleanValue(false)).isTrue();
        assertThat(friend.path("redeem_until").stringValue(null)).isEqualTo("2026-11-30T00:00:00.000000Z");
        assertThat(friend.toString()).doesNotContain(INVITER.toString(), "@example.com");
    }

    @Test
    @DisplayName("넣기 규칙: 없는 코드 404, 내 코드 409, 7일 지남 409, 성공 뒤 다시 넣으면 409. 초대 경로는 가입 출처와 따로 남는다")
    void redeemRules() throws Exception {
        String code = codeOf(INVITER);
        String own = codeOf(FRIEND);

        assertThat(detail(json(FRIEND, redeem("ZZZZZZ"), 404))).isEqualTo("invite_code_not_found");
        assertThat(detail(json(FRIEND, redeem(own), 409))).isEqualTo("own_invite_code");
        assertThat(detail(json(OLD, redeem(code), 409))).isEqualTo("invite_window_closed");

        JsonNode redeemed = json(FRIEND, redeem(code.toLowerCase()), 200);
        assertThat(redeemed.path("redeemed").booleanValue(false)).isTrue();
        assertThat(redeemed.path("can_redeem").booleanValue(true)).isFalse();
        assertThat(detail(json(FRIEND, redeem(code), 409))).isEqualTo("invite_already_redeemed");
        assertThat(jdbc.queryForObject("SELECT inviter_id FROM invite_redemptions WHERE invitee_id=?", UUID.class, FRIEND))
                .isEqualTo(INVITER);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM user_signup_attributions", Integer.class)).isZero();
    }

    @Test
    @DisplayName("탈퇴한 사람의 코드는 없는 코드로 본다")
    void deactivatedInviterCodeIsNotFound() throws Exception {
        String code = codeOf(INVITER);
        jdbc.update("UPDATE users SET status='deactivated', deactivated_at=now() WHERE id=?", INVITER);

        assertThat(detail(json(FRIEND, redeem(code), 404))).isEqualTo("invite_code_not_found");
    }

    @Test
    @DisplayName("코드를 넣은 친구가 리딩을 끝내면 둘 다 Pro 1개월을 한 번 받는다. 결제 구독은 그대로고, 두 번째 완료는 지급하지 않는다")
    void firstReadingRewardsBothOnce() throws Exception {
        String code = codeOf(INVITER);
        json(FRIEND, redeem(code), 200);
        // 초대자는 이미 결제 중 — 구독 줄은 건드리지 않고 지급 기간만 남는다.
        jdbc.update("""
                INSERT INTO billing_subscriptions(id,user_id,status,provider,customer_key,amount,current_period_start,current_period_end)
                VALUES (?,?,'active','toss','ck-inviter',3900,?,?)
                """, UUID.randomUUID(), INVITER, ts("2026-11-01T00:00:00Z"), ts("2026-12-01T00:00:00Z"));

        UUID session = completedReading(FRIEND);
        completedReading(FRIEND);

        assertThat(jdbc.queryForObject("SELECT rewarded_at FROM invite_redemptions WHERE invitee_id=?", OffsetDateTime.class,
                FRIEND)).isNotNull();
        assertThat(jdbc.queryForObject("SELECT inviter_rewarded FROM invite_redemptions WHERE invitee_id=?", Boolean.class,
                FRIEND)).isTrue();
        for (UUID user : List.of(FRIEND, INVITER)) {
            assertThat(jdbc.queryForList("""
                    SELECT starts_at, ends_at FROM billing_pro_grants WHERE user_id=? AND reason='friend_invite'
                    """, user)).as("user %s", user).hasSize(1);
            assertThat(jdbc.queryForObject("""
                    SELECT ends_at = starts_at + interval '1 month' FROM billing_pro_grants WHERE user_id=?
                    """, Boolean.class, user)).isTrue();
        }
        assertThat(jdbc.queryForObject("SELECT status FROM billing_subscriptions WHERE user_id=?", String.class, INVITER))
                .isEqualTo("active");
        assertThat(json(FRIEND, get("/v2/invite/me"), 200).path("rewarded").booleanValue(false)).isTrue();
        assertThat(json(INVITER, get("/v2/invite/me"), 200).path("reward_count").intValue()).isEqualTo(1);
        assertThat(session).isNotNull();
    }

    @Test
    @DisplayName("초대자가 이번 달 상한(여기서는 1)을 채웠으면 친구만 받고 초대자는 받지 않는다")
    void inviterMonthlyCap() throws Exception {
        String code = codeOf(INVITER);
        json(FRIEND, redeem(code), 200);
        json(SECOND, redeem(code), 200);

        completedReading(FRIEND);
        completedReading(SECOND);

        assertThat(jdbc.queryForObject("SELECT count(*) FROM billing_pro_grants WHERE user_id=?", Integer.class, INVITER))
                .isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM billing_pro_grants WHERE user_id=?", Integer.class, SECOND))
                .isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT inviter_rewarded FROM invite_redemptions WHERE invitee_id=?", Boolean.class,
                SECOND)).isFalse();
    }

    @Test
    @DisplayName("코드를 넣지 않은 사람의 리딩 완료는 아무것도 지급하지 않는다")
    void noRedemptionNoReward() throws Exception {
        completedReading(FRIEND);

        assertThat(jdbc.queryForObject("SELECT count(*) FROM billing_pro_grants", Integer.class)).isZero();
    }

    // ── 도우미 ─────────────────────────────────────────────────────

    private void member(UUID id, String createdAt) {
        jdbc.update("INSERT INTO users(id,status,email,created_at) VALUES (?,'active',?,?)", id, id + "@example.com",
                ts(createdAt));
        jdbc.update("INSERT INTO user_identities(id,user_id,provider,provider_uid) VALUES (?,?,'google',?)",
                UUID.randomUUID(), id, "g-" + id);
        AccountFixtures.passGate(jdbc, id);
    }

    /** 진행 중 회차 하나를 세우고 서비스로 끝까지 저장한다 — 완료 알림이 실제 연결로 초대 지급까지 가는지 본다. */
    private UUID completedReading(UUID user) {
        UUID script = UUID.randomUUID();
        UUID nina = UUID.randomUUID();
        UUID line = UUID.randomUUID();
        UUID session = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO scripts(id,user_id,title,raw_text,raw_hash,source,request_id,request_fingerprint)
                VALUES (?,?,'갈매기','원문',repeat('0',64),'paste',?,?)
                """, script, user, UUID.randomUUID(), "a".repeat(64));
        jdbc.update("INSERT INTO script_characters(id,script_id,name,sort_order) VALUES (?,?,'니나',0)", nina, script);
        jdbc.update("INSERT INTO script_lines(id,script_id,ordinal,kind,character_id,text) VALUES (?,?,1,'dialogue',?,'안녕')",
                line, script, nina);
        jdbc.update("""
                INSERT INTO reading_sessions(id,script_id,user_id,request_id,my_character_ids,mode,start_line_id,end_line_id,advance,
                                             record,status,current_line_id)
                VALUES (?,?,?,?,CAST(? AS uuid[]),'read',?,?,'manual',true,'in_progress',?)
                """, session, script, user, UUID.randomUUID(), "{" + nina + "}", line, line, line);
        sessions.saveProgress(user, session, new ProgressChange(1, line, 10, List.of(), true));
        return session;
    }

    private String codeOf(UUID user) throws Exception {
        return json(user, get("/v2/invite/me"), 200).path("code").stringValue(null);
    }

    private MockHttpServletRequestBuilder redeem(String code) {
        return post("/v2/invite/redeem").content("{\"code\":\"" + code + "\"}");
    }

    private JsonNode json(UUID user, MockHttpServletRequestBuilder request, int status) throws Exception {
        MockHttpServletResponse response = mvc.perform(request
                        .header("Authorization", "Bearer " + jwt.issueAccessToken(user).value())
                        .contentType(MediaType.APPLICATION_JSON))
                .andReturn()
                .getResponse();
        assertThat(response.getStatus()).as(response.getContentAsString()).isEqualTo(status);
        if (status == 200) {
            assertThat(response.getHeader("Cache-Control")).isEqualTo("no-store");
        }
        String body = response.getContentAsString();
        return body.isEmpty() ? mapper.nullNode() : mapper.readTree(body);
    }

    private static String detail(JsonNode error) {
        return LenientJson.asText(error.path("detail"));
    }

    private static OffsetDateTime ts(String instant) {
        return OffsetDateTime.parse(instant);
    }
}
