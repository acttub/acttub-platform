package com.acttub.actingapi.feature.push;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import java.util.Map;
import java.util.UUID;

import com.acttub.actingapi.feature.auth.app.JwtService;
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

/** 푸시를 눌러 앱을 연 기록(POST /v2/push-opens) — 행이 남는 것, 동의 전에도 받는 것, 검증, 한도. */
@SpringBootTest(properties = {"JWT_SECRET=test-secret", "ACCOUNT_CLEANUP_ENABLED=false"})
@AutoConfigureMockMvc
class PushOpenIT {

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        String name = PostgresContainerSupport.createDatabaseName("push_open_it");
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

    @BeforeEach
    void clean() {
        jdbc.execute("TRUNCATE TABLE users,consent_documents RESTART IDENTITY CASCADE");
    }

    @Test
    @DisplayName("push.open: 연습 알림을 눌러 연 것은 종류·문구·플랫폼·앱 버전과 함께 한 줄 남는다")
    void recordsOneRowWithTheReminderFields() throws Exception {
        UUID user = member(true);

        var response = open(user, "{\"kind\":\"evening_reminder\",\"reminder_kind\":\"streak\","
                + "\"template_id\":\"streak.1.a\",\"platform\":\"ios\"}");

        assertThat(response.getStatus()).isEqualTo(204);
        Map<String, Object> row = jdbc.queryForMap("SELECT * FROM push_opens WHERE user_id=?", user);
        assertThat(row).containsEntry("kind", "evening_reminder")
                .containsEntry("reminder_kind", "streak")
                .containsEntry("template_id", "streak.1.a")
                .containsEntry("platform", "ios")
                .containsEntry("app_version", "0.1.2");
        assertThat(row.get("opened_at")).isNotNull();
    }

    @Test
    @DisplayName("push.open: 동의가 남은 회원이 눌러도 남는다. 선택 항목은 비워 둘 수 있다")
    void recordsEvenWhenConsentIsPending() throws Exception {
        UUID user = member(false);

        assertThat(open(user, "{\"kind\":\"analysis_complete\"}").getStatus()).isEqualTo(204);

        assertThat(jdbc.queryForMap("SELECT reminder_kind,template_id,platform FROM push_opens WHERE user_id=?", user))
                .containsEntry("reminder_kind", null)
                .containsEntry("template_id", null)
                .containsEntry("platform", null);
    }

    @Test
    @DisplayName("push.open: 로그인 없으면 401, 종류가 비었거나 길거나 플랫폼이 모르는 값이면 422, 모르는 키도 422 — 행은 안 남는다")
    void rejectsBadRequests() throws Exception {
        UUID user = member(true);

        var anonymous = mvc.perform(post("/v2/push-opens").contentType(MediaType.APPLICATION_JSON)
                .content("{\"kind\":\"x\"}")).andReturn().getResponse();
        assertThat(anonymous.getStatus()).isEqualTo(401);
        assertThat(open(user, "{\"kind\":\"\"}").getStatus()).isEqualTo(422);
        assertThat(open(user, "{\"kind\":\"" + "k".repeat(41) + "\"}").getStatus()).isEqualTo(422);
        assertThat(open(user, "{\"kind\":\"x\",\"template_id\":\"" + "t".repeat(61) + "\"}").getStatus()).isEqualTo(422);
        assertThat(open(user, "{\"kind\":\"x\",\"platform\":\"web\"}").getStatus()).isEqualTo(422);
        assertThat(open(user, "{\"kind\":\"x\",\"extra\":1}").getStatus()).isEqualTo(422);
        assertThat(open(user, "{}").getStatus()).isEqualTo(422);

        assertThat(jdbc.queryForObject("SELECT count(*) FROM push_opens", Integer.class)).isZero();
    }

    @Test
    @DisplayName("push.open: 한 회원이 분당 60번을 넘기면 429")
    void limitsPerUser() throws Exception {
        UUID user = member(true);
        for (int i = 0; i < 60; i++) {
            assertThat(open(user, "{\"kind\":\"x\"}").getStatus()).isEqualTo(204);
        }

        assertThat(open(user, "{\"kind\":\"x\"}").getStatus()).isEqualTo(429);
    }

    private MockHttpServletResponse open(UUID user, String body) throws Exception {
        return mvc.perform(post("/v2/push-opens")
                        .header("Authorization", "Bearer " + jwt.issueAccessToken(user).value())
                        .header("X-Acttub-Client", "app/0.1.2")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andReturn().getResponse();
    }

    private UUID member(boolean gatePassed) {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO users(id,status) VALUES (?,'active')", id);
        jdbc.update("INSERT INTO user_identities(id,user_id,provider,provider_uid) VALUES (?,?,'google',?)",
                UUID.randomUUID(), id, "g-" + id);
        if (gatePassed) {
            AccountFixtures.passGate(jdbc, id);
        } else {
            jdbc.update("""
                    INSERT INTO consent_documents(id,type,version,title,body,required,published_at)
                    VALUES (?,'terms','v1','약관','본문',true,now())
                    """, UUID.randomUUID());
        }
        return id;
    }
}
