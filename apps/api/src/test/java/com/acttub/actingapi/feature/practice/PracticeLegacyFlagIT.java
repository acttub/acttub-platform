package com.acttub.actingapi.feature.practice;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import java.util.UUID;

import com.acttub.actingapi.feature.auth.app.JwtService;
import com.acttub.actingapi.support.AccountFixtures;
import com.acttub.actingapi.support.PostgresContainerSupport;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;

/**
 * 신형 생성 플래그를 <b>끈</b> 서버 (practice.start). 같은 요청·같은 헤더라도 회차는 legacy 다 — 플래그·헤더·무입력
 * 셋이 모두 맞아야만 신형이기 때문이다. 켠 경우는 {@link PracticeLifecycleIT}.
 */
@SpringBootTest(properties = {
    "JWT_SECRET=test-secret",
    "ACCOUNT_CLEANUP_ENABLED=false",
    "ACCOUNT_HOUSEKEEPING_ENABLED=false",
    "ACTTUB_THREE_LAYERS_ENABLED=false"
})
@AutoConfigureMockMvc
class PracticeLegacyFlagIT {

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        String name = PostgresContainerSupport.createDatabaseName("practice_legacy_flag");
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

    private UUID member;
    private String bearer;
    private UUID video;

    @BeforeEach
    void setUp() {
        jdbc.execute("TRUNCATE TABLE users RESTART IDENTITY CASCADE");
        member = UUID.randomUUID();
        jdbc.update("INSERT INTO users(id,status) VALUES (?,'active')", member);
        jdbc.update("INSERT INTO user_identities(id,user_id,provider,provider_uid) VALUES (?,?,'google',?)",
                UUID.randomUUID(), member, "g-" + member);
        AccountFixtures.passGate(jdbc, member);
        bearer = "Bearer " + jwt.issueAccessToken(member).value();
        video = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO videos(id,user_id,object_key,content_type,byte_size,duration_ms)
                VALUES (?,?,?,'video/mp4',1000,12000)
                """, video, member, "videos/" + member + "/" + video + ".mp4");
    }

    @Test
    @DisplayName("practice.start: 신형 생성 플래그를 끈 서버 — 헤더가 three_layers_v1 이고 영상만 골라도 experience_version 은 legacy 다")
    void practiceStart_theFlagGatesTheNewExperience() throws Exception {
        var response = mvc.perform(post("/v2/practices")
                        .header("Authorization", bearer)
                        .header("X-Acttub-Contract", "three_layers_v1")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"request_id\":\"" + UUID.randomUUID() + "\",\"video_id\":\"" + video + "\"}"))
                .andReturn().getResponse();

        assertThat(response.getStatus()).as(response.getContentAsString()).isEqualTo(201);
        assertThat(mapper.readTree(response.getContentAsString()).path("experience_version").textValue())
                .isEqualTo("legacy");
        assertThat(jdbc.queryForObject("SELECT experience_version FROM practices", String.class)).isEqualTo("legacy");
    }
}
