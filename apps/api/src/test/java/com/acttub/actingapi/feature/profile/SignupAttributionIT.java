package com.acttub.actingapi.feature.profile;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;

import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import com.acttub.actingapi.feature.auth.app.JwtService;
import com.acttub.actingapi.feature.profile.app.ProfileService;
import com.acttub.actingapi.support.AccountFixtures;
import com.acttub.actingapi.support.PostgresContainerSupport;
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
@SpringBootTest(properties = {"JWT_SECRET=test-secret", "ACCOUNT_CLEANUP_ENABLED=false"})
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

    private UUID member;
    private String bearer;

    @BeforeEach
    void setUp() {
        jdbc.execute("TRUNCATE TABLE users,consent_documents RESTART IDENTITY CASCADE");
        jdbc.update("""
                INSERT INTO consent_documents(id,type,version,title,body,required,published_at)
                VALUES (?,'terms','v1','약관','본문',true,?)
                """, UUID.randomUUID(), OffsetDateTime.of(2026, 10, 1, 0, 0, 0, 0, ZoneOffset.UTC));
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

    private MockHttpServletResponse record(String body) throws Exception {
        return mvc.perform(put("/v2/me/signup-attribution")
                        .header("Authorization", bearer)
                        .header("X-Acttub-Client", "app/0.1.2")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andReturn().getResponse();
    }

    private int count() {
        Integer count = jdbc.queryForObject(
                "SELECT count(*) FROM user_signup_attributions WHERE user_id=?", Integer.class, member);
        return count == null ? 0 : count;
    }
}
