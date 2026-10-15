package com.acttub.actingapi.feature.profile;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;

import java.util.Optional;
import java.util.UUID;

import com.acttub.actingapi.feature.auth.app.JwtService;
import com.acttub.actingapi.feature.profile.app.AirbridgeAttributionSync;
import com.acttub.actingapi.feature.profile.app.ProfileService;
import com.acttub.actingapi.integration.airbridge.AirbridgeAttribution;
import com.acttub.actingapi.integration.airbridge.AirbridgeAttributionClient;
import com.acttub.actingapi.support.AccountFixtures;
import com.acttub.actingapi.support.PostgresContainerSupport;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;

/**
 * 앱이 넘긴 Airbridge 기기 ID(SOMA-643, V43) — {@code PUT /v2/me/airbridge-device} 와 서버 재조회를 HTTP 와 실제
 * Postgres 로 본다. 처음 온 값만 두는지, 422 로 막히는지, 귀속을 적으면 기기 ID 가 지워지는지, 탈퇴가 지우는지.
 */
@SpringBootTest(properties = {
    "JWT_SECRET=test-secret",
    "ACCOUNT_CLEANUP_ENABLED=false",
    "AIRBRIDGE_API_TOKEN=test-token",
    "AIRBRIDGE_DEVICE_MIN_PRIVACY_VERSION=v9",
    "AIRBRIDGE_LOOKUP_INTERVAL_MS=86400000",
    "AIRBRIDGE_LOOKUP_INITIAL_DELAY_MS=86400000"
})
@AutoConfigureMockMvc
class AirbridgeDeviceIT {
    private static final String DEVICE = "11111111-2222-3333-4444-555555555555";

    @TestConfiguration
    static class FakeAirbridge {
        static volatile Optional<AirbridgeAttribution> answer = Optional.empty();

        @Bean
        @Primary
        AirbridgeAttributionClient fakeAirbridge() {
            return new AirbridgeAttributionClient() {
                @Override
                public boolean enabled() {
                    return true;
                }

                @Override
                public Optional<AirbridgeAttribution> lookup(String deviceUuid) {
                    return answer;
                }
            };
        }
    }

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        String name = PostgresContainerSupport.createDatabaseName("airbridge_device");
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
    AirbridgeAttributionSync sync;

    private UUID member;
    private String bearer;

    @BeforeEach
    void setUp() {
        jdbc.execute("TRUNCATE TABLE users,consent_documents RESTART IDENTITY CASCADE");
        FakeAirbridge.answer = Optional.empty();
        member = UUID.randomUUID();
        jdbc.update("INSERT INTO users(id,status) VALUES (?,'active')", member);
        jdbc.update("INSERT INTO user_identities(id,user_id,provider,provider_uid) VALUES (?,?,'google',?)",
                UUID.randomUUID(), member, "g-" + member);
        // 기기 ID 를 받는다는 내용의 동의 판(v9)이 현재 판이다. 가드 테스트는 이 판을 바꿔서 본다.
        publishPrivacy("v9", "2026-10-15T00:00:00Z");
        AccountFixtures.passGate(jdbc, member);
        bearer = "Bearer " + jwt.issueAccessToken(member).value();
    }

    @Test
    @DisplayName("기기 ID 는 계정마다 처음 것만 두고 다시 보내도 204 다")
    void keepsTheFirstDevice() throws Exception {
        assertThat(send("android", DEVICE).getStatus()).isEqualTo(204);
        assertThat(send("android", "AAAAAAAA-2222-3333-4444-555555555555").getStatus()).isEqualTo(204);

        assertThat(jdbc.queryForList(
                "SELECT device_uuid FROM user_airbridge_device_lookups WHERE user_id=?", String.class, member))
                .containsExactly(DEVICE);
    }

    @Test
    @DisplayName("UUID 가 아니거나 모두 0 이거나 platform 이 틀리면 422 이고 아무것도 두지 않는다")
    void rejectsBadValues() throws Exception {
        assertThat(send("android", "not-a-uuid").getStatus()).isEqualTo(422);
        assertThat(send("android", "00000000-0000-0000-0000-000000000000").getStatus()).isEqualTo(422);
        assertThat(send("web", DEVICE).getStatus()).isEqualTo(422);
        assertThat(rows()).isZero();
    }

    @Test
    @DisplayName("이미 유입 기록이 있으면 기기 ID 를 두지 않는다")
    void skipsWhenAttributionExists() throws Exception {
        jdbc.update("INSERT INTO user_signup_attributions(user_id,source,platform,channel) "
                + "VALUES (?,'airbridge','ios','unattributed')", member);

        assertThat(send("ios", DEVICE).getStatus()).isEqualTo(204);

        assertThat(rows()).isZero();
    }

    @Test
    @DisplayName("재조회가 귀속을 받으면 airbridge 출처로 적고 기기 ID 줄을 지운다")
    void syncRecordsAndDeletes() throws Exception {
        assertThat(send("android", DEVICE).getStatus()).isEqualTo(204);
        FakeAirbridge.answer = Optional.of(
                new AirbridgeAttribution("facebook.business", "ACTTUB", null, null, null, null, null));

        sync.runOnce();

        assertThat(jdbc.queryForMap(
                "SELECT source,platform,channel,campaign FROM user_signup_attributions WHERE user_id=?", member))
                .containsEntry("source", "airbridge")
                .containsEntry("platform", "android")
                .containsEntry("channel", "facebook.business")
                .containsEntry("campaign", "ACTTUB");
        assertThat(jdbc.queryForObject(
                "SELECT recorded_via FROM user_signup_attributions WHERE user_id=?", String.class, member))
                .isEqualTo("server");
        assertThat(rows()).isZero();
    }

    @Test
    @DisplayName("결과가 없으면 줄이 남고 다음 시도가 뒤로 밀린다. 24시간이 지나면 지운다")
    void syncBacksOffThenExpires() throws Exception {
        assertThat(send("android", DEVICE).getStatus()).isEqualTo(204);

        sync.runOnce();

        assertThat(jdbc.queryForMap("""
                SELECT attempts, next_attempt_at > now() AS later
                FROM user_airbridge_device_lookups WHERE user_id=?
                """, member)).containsEntry("attempts", 1).containsEntry("later", true);

        jdbc.update("UPDATE user_airbridge_device_lookups SET created_at=now()-interval '25 hours', "
                + "next_attempt_at=now()-interval '1 minute' WHERE user_id=?", member);
        sync.runOnce();

        assertThat(rows()).isZero();
        assertThat(jdbc.queryForObject(
                "SELECT count(*) FROM user_signup_attributions WHERE user_id=?", Integer.class, member)).isZero();
    }

    @Test
    @DisplayName("탈퇴하면 기기 ID 줄을 지우고, 탈퇴한 계정에는 다시 두지 않는다")
    void withdrawalErasesTheDevice() throws Exception {
        assertThat(send("ios", DEVICE).getStatus()).isEqualTo(204);

        profiles.withdraw(member);

        assertThat(rows()).isZero();
        assertThat(send("ios", DEVICE).getStatus()).isEqualTo(403);
        assertThat(rows()).isZero();
    }

    @Test
    @DisplayName("현재 privacy 판이 최소 판(v9)보다 낮으면 기기 ID 를 두지 않고 204 다")
    void doesNotKeepTheDeviceBeforeTheConsentVersionIsPublished() throws Exception {
        jdbc.update("UPDATE consent_documents SET version='v7' WHERE type='privacy'");

        assertThat(send("android", DEVICE).getStatus()).isEqualTo(204);

        assertThat(rows()).isZero();
    }

    @Test
    @DisplayName("v9 가 새로 공개되면 v9 에 동의한 회원만 통과한다 — 옛 판 동의만 있으면 게이트에서 막힌다")
    void onlyV9ConsentingMembersPassOncePublished() throws Exception {
        jdbc.update("UPDATE consent_documents SET version='v7' WHERE type='privacy'");
        publishPrivacy("v9", "2026-10-16T00:00:00Z");

        // 아직 v9 를 결정하지 않았다 — 게이트(동의 미결정)에서 막힌다. 저장되지 않는다.
        assertThat(send("android", DEVICE).getStatus()).isNotEqualTo(204);
        assertThat(rows()).isZero();

        AccountFixtures.grantAllConsents(jdbc, member);
        assertThat(send("android", DEVICE).getStatus()).isEqualTo(204);
        assertThat(rows()).isEqualTo(1);
    }

    private void publishPrivacy(String version, String publishedAt) {
        jdbc.update("""
                INSERT INTO consent_documents(id,type,version,title,body,required,published_at)
                VALUES (?,'privacy',?,'개인정보 수집·이용 동의','본문',true,CAST(? AS timestamptz))
                """, UUID.randomUUID(), version, publishedAt);
    }

    private int rows() {
        return jdbc.queryForObject("SELECT count(*) FROM user_airbridge_device_lookups", Integer.class);
    }

    private MockHttpServletResponse send(String platform, String device) throws Exception {
        return mvc.perform(put("/v2/me/airbridge-device")
                        .header("Authorization", bearer)
                        .header("X-Acttub-Client", "app/0.1.2")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"platform\":\"" + platform + "\",\"device_uuid\":\"" + device + "\"}"))
                .andReturn().getResponse();
    }
}
