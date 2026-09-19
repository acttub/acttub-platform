package com.acttub.actingapi.feature.push;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;

import com.acttub.actingapi.feature.auth.app.JwtService;
import com.acttub.actingapi.feature.push.app.PushTokenRepository;
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
 * account.notification 의 "검증 방법" 가운데 서버의 몫 — 토글 셋과 푸시 토큰의 수명 — 을 HTTP 와 실제
 * Postgres 로 본다. 실제 폰에 알림이 오는지, 밤 10시 알람, 권한 안내는 앱 갈래와 사람이 본다. 챌린지
 * 알림의 발송은 challenge.notification 의 일이고 여기서는 토글과 토큰만 본다. "등록되지 않은 기기"와
 * 발송 실패는 {@code PushServiceTest}·{@code ExpoPushSenderTest} 가 본다.
 */
@SpringBootTest(properties = {"JWT_SECRET=test-secret", "ACCOUNT_CLEANUP_ENABLED=false"})
@AutoConfigureMockMvc
class AccountNotificationIT {
    private static final AtomicInteger ADDRESSES = new AtomicInteger();

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        String name = PostgresContainerSupport.createDatabaseName("account_notification");
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
    PushTokenRepository tokens;

    private UUID member;
    private String bearer;

    @BeforeEach
    void setUp() {
        jdbc.execute("TRUNCATE TABLE users,consent_documents RESTART IDENTITY CASCADE");
        jdbc.update("""
                INSERT INTO consent_documents(id,type,version,title,body,required,published_at)
                VALUES (?,'terms','v1','약관','본문',true,?)
                """, UUID.randomUUID(), OffsetDateTime.of(2026, 10, 1, 0, 0, 0, 0, ZoneOffset.UTC));
        member = member();
        bearer = "Bearer " + jwt.issueAccessToken(member).value();
    }

    @Test
    @DisplayName("account.notification: 가입 직후 설정을 열면 토글 셋이 모두 켜져 있다")
    void accountNotification_everyToggleStartsOn() throws Exception {
        var response = mvc.perform(get("/v2/me/notification-settings").header("Authorization", bearer))
                .andReturn().getResponse();

        assertThat(response.getStatus()).isEqualTo(200);
        assertThat(mapper.readTree(response.getContentAsString())).isEqualTo(mapper.readTree("""
                {"analysis_done":true,"challenge":true,"evening_reminder":true}
                """));
    }

    @Test
    @DisplayName("account.notification: 바꿀 토글만 보내면 그것만 바뀌고 토글 셋 전체가 돌아온다. 하나만 꺼져 있으면 토큰은 남는다")
    void accountNotification_patchChangesOnlyWhatWasSentAndReturnsAllThree() throws Exception {
        register(bearer, "ExponentPushToken[phone]");

        JsonNode changed = patchSettings("{\"challenge\":false}", 200);

        assertThat(changed).isEqualTo(mapper.readTree("""
                {"analysis_done":true,"challenge":false,"evening_reminder":true}
                """));
        assertThat(patchSettings("{\"evening_reminder\":false}", 200)).isEqualTo(mapper.readTree("""
                {"analysis_done":true,"challenge":false,"evening_reminder":false}
                """));
        assertThat(count("push_tokens")).as("챌린지 알림만 끄면 토큰은 두고, 보내기 전에 토글을 읽어 거른다").isEqualTo(1);
    }

    @Test
    @DisplayName("account.notification: 분석 완료 토글을 끄면 분석이 끝나도 알릴 곳이 없고, 켜면 다시 생긴다")
    void accountNotification_analysisDoneToggleFiltersTheTargets() throws Exception {
        register(bearer, "ExponentPushToken[phone]");
        register(bearer, "ExponentPushToken[tablet]");
        UUID session = practice(member);
        assertThat(tokens.analysisDoneTargets(session))
                .as("폰 두 대에 로그인했으면 둘 다 받는다")
                .containsExactly("ExponentPushToken[phone]", "ExponentPushToken[tablet]");

        patchSettings("{\"analysis_done\":false}", 200);
        assertThat(tokens.analysisDoneTargets(session)).isEmpty();

        patchSettings("{\"analysis_done\":true}", 200);
        assertThat(tokens.analysisDoneTargets(session)).hasSize(2);
    }

    @Test
    @DisplayName("account.notification: 폰 두 대에 로그인한 회원이 푸시 토글 둘을 끄면 서버에 그 회원의 토큰이 하나도 없다. 하나를 다시 켠 뒤 다른 폰에서 앱을 열면 그 폰의 토큰이 다시 생긴다")
    void accountNotification_turningBothPushesOffForgetsEveryDevice() throws Exception {
        UUID other = member();
        register(bearer, "ExponentPushToken[phone]");
        register(bearer, "ExponentPushToken[tablet]");
        register("Bearer " + jwt.issueAccessToken(other).value(), "ExponentPushToken[someone-else]");

        patchSettings("{\"analysis_done\":false}", 200);
        assertThat(tokensOf(member)).hasSize(2);
        patchSettings("{\"challenge\":false}", 200);

        assertThat(tokensOf(member)).isEmpty();
        assertThat(tokensOf(other)).as("남의 토큰은 그대로다").containsExactly("ExponentPushToken[someone-else]");

        // 둘 다 꺼져 있는 동안에는 다른 폰이 앱을 열어도 토큰이 되살아나지 않는다.
        register(bearer, "ExponentPushToken[tablet]");
        assertThat(tokensOf(member)).isEmpty();

        patchSettings("{\"challenge\":true}", 200);
        register(bearer, "ExponentPushToken[tablet]");
        assertThat(tokensOf(member)).containsExactly("ExponentPushToken[tablet]");
    }

    @Test
    @DisplayName("account.notification: 토글의 422 — 불리언이 아닌 값, 모르는 키, 빈 본문")
    void accountNotification_patchRejectsMalformedBodies() throws Exception {
        for (String body : List.of("{\"challenge\":\"off\"}", "{\"marketing\":true}", "{}")) {
            JsonNode error = patchSettings(body, 422);
            assertThat(error.path("detail").isArray()).as(body).isTrue();
        }
        assertThat(jdbc.queryForObject("SELECT notify_challenge FROM user_profiles WHERE user_id=?",
                Boolean.class, member)).isTrue();
    }

    @Test
    @DisplayName("account.notification: 동의를 결정하기 전에 토큰 등록 요청 — 403. 프로필을 채우기 전에도 403 이다")
    void accountNotification_registrationWaitsForTheGate() throws Exception {
        UUID undecided = UUID.randomUUID();
        jdbc.update("INSERT INTO users(id,status) VALUES (?,'active')", undecided);
        jdbc.update("INSERT INTO user_identities(id,user_id,provider,provider_uid) VALUES (?,?,'google',?)",
                UUID.randomUUID(), undecided, "g-" + undecided);
        String token = "Bearer " + jwt.issueAccessToken(undecided).value();

        var beforeConsent = postToken(token, "ExponentPushToken[early]");
        assertThat(beforeConsent.getStatus()).isEqualTo(403);
        assertThat(mapper.readTree(beforeConsent.getContentAsString()).path("detail").textValue())
                .isEqualTo("consent_required");

        AccountFixtures.grantAllConsents(jdbc, undecided);
        var beforeProfile = postToken(token, "ExponentPushToken[early]");
        assertThat(beforeProfile.getStatus()).isEqualTo(403);
        assertThat(mapper.readTree(beforeProfile.getContentAsString()).path("detail").textValue())
                .isEqualTo("profile_required");
        assertThat(count("push_tokens")).as("동의 전에는 기기 정보를 받지 않는다").isZero();

        AccountFixtures.completeProfile(jdbc, undecided);
        assertThat(postToken(token, "ExponentPushToken[early]").getStatus()).isEqualTo(204);
    }

    @Test
    @DisplayName("account.notification: 액세스 토큰 없이 토큰 삭제 요청 — 204 이고 그 토큰 행이 없다. 만료된 토큰이 붙어 와도, 없는 토큰이어도 같은 204 다")
    void accountNotification_deletionNeedsNoLogin() throws Exception {
        register(bearer, "ExponentPushToken[phone]");
        register(bearer, "ExponentPushToken[tablet]");

        var bare = deleteToken(null, "ExponentPushToken[phone]");
        var stale = deleteToken("Bearer expired.token.value", "ExponentPushToken[tablet]");
        var unknown = deleteToken(null, "ExponentPushToken[never-registered]");

        for (var response : List.of(bare, stale, unknown)) {
            assertThat(response.getStatus()).as(response.getContentAsString()).isEqualTo(204);
        }
        assertThat(count("push_tokens")).isZero();
    }

    @Test
    @DisplayName("account.notification: 토큰 삭제는 한 IP 에서 분당 60회까지다")
    void accountNotification_deletionIsLimitedPerIp() throws Exception {
        String address = "10.8.0." + ADDRESSES.incrementAndGet();
        for (int request = 0; request < 60; request++) {
            assertThat(deleteFrom(address, "ExponentPushToken[x]").getStatus()).isEqualTo(204);
        }

        var limited = deleteFrom(address, "ExponentPushToken[x]");

        assertThat(limited.getStatus()).isEqualTo(429);
        assertThat(mapper.readTree(limited.getContentAsString()))
                .isEqualTo(mapper.readTree("{\"detail\":\"rate limit exceeded\"}"));
    }

    // ---- helpers ----

    private UUID member() {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO users(id,status) VALUES (?,'active')", id);
        jdbc.update("INSERT INTO user_identities(id,user_id,provider,provider_uid) VALUES (?,?,'google',?)",
                UUID.randomUUID(), id, "g-" + id);
        AccountFixtures.passGate(jdbc, id);
        return id;
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
                VALUES (?,?,?,'analyzing','상황','인물','분석','캐릭터 분석','목표')
                """, session, owner, upload);
        return session;
    }

    private void register(String authorization, String token) throws Exception {
        assertThat(postToken(authorization, token).getStatus()).isEqualTo(204);
    }

    private MockHttpServletResponse postToken(String authorization, String token) throws Exception {
        return mvc.perform(post("/v2/push-tokens")
                        .header("Authorization", authorization)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"token\":\"" + token + "\",\"platform\":\"ios\"}"))
                .andReturn().getResponse();
    }

    private MockHttpServletResponse deleteToken(String authorization, String token) throws Exception {
        var request = delete("/v2/push-tokens")
                .with(servlet -> {
                    servlet.setRemoteAddr("10.9.0." + ADDRESSES.incrementAndGet());
                    return servlet;
                })
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"token\":\"" + token + "\"}");
        if (authorization != null) {
            request.header("Authorization", authorization);
        }
        return mvc.perform(request).andReturn().getResponse();
    }

    private MockHttpServletResponse deleteFrom(String address, String token) throws Exception {
        return mvc.perform(delete("/v2/push-tokens")
                        .with(servlet -> {
                            servlet.setRemoteAddr(address);
                            return servlet;
                        })
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"token\":\"" + token + "\"}"))
                .andReturn().getResponse();
    }

    private JsonNode patchSettings(String body, int status) throws Exception {
        var response = mvc.perform(patch("/v2/me/notification-settings")
                        .header("Authorization", bearer)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andReturn().getResponse();
        assertThat(response.getStatus()).as(response.getContentAsString()).isEqualTo(status);
        return mapper.readTree(response.getContentAsString());
    }

    private List<String> tokensOf(UUID owner) {
        return jdbc.queryForList("SELECT token FROM push_tokens WHERE user_id=? ORDER BY token", String.class, owner);
    }

    private int count(String table) {
        return jdbc.queryForObject("SELECT count(*) FROM " + table, Integer.class);
    }
}
