package com.acttub.actingapi.feature.report.adapter.web;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import java.util.UUID;

import com.acttub.actingapi.feature.auth.app.JwtService;
import com.acttub.actingapi.support.AccountFixtures;
import com.acttub.actingapi.support.PostgresContainerSupport;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.http.MediaType;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest(properties = "JWT_SECRET=test-secret")
@AutoConfigureMockMvc
class ReportNoStorageIT {
    private static final UUID USER =
            UUID.fromString("00000000-0000-4000-8000-000000000503");

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        String name = PostgresContainerSupport.createDatabaseName("report_no_storage");
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

    @BeforeEach
    void setUp() {
        jdbc.execute("TRUNCATE TABLE users RESTART IDENTITY CASCADE");
        jdbc.update("""
                INSERT INTO users (id,email,status)
                VALUES (?,?,'active')
                """, USER, "report-no-storage@example.test");
        AccountFixtures.completeProfile(jdbc, USER);
        grantAllConsents();
    }

    @Test
    void videoUploadWithoutConfiguredStorageReturnsExact503Contract() throws Exception {
        var response = mvc.perform(post("/v2/videos/intents")
                        .header("Authorization", "Bearer " + jwt.issueAccessToken(USER).value())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"request_id":"%s","content_type":"video/mp4","byte_size":1000,"duration_ms":12000}
                                """.formatted(UUID.randomUUID())))
                .andReturn().getResponse();
        assertThat(response.getStatus()).isEqualTo(503);
        assertThat(mapper.readTree(response.getContentAsString()))
                .isEqualTo(mapper.readTree("{\"detail\":\"storage_not_configured\"}"));
        assertThat(jdbc.queryForObject("SELECT count(*) FROM upload_intents", Integer.class)).isZero();
    }

    @Test
    void videoWithoutConfiguredStorageStillShowsItsRecordWithoutPlayback() throws Exception {
        var response = mvc.perform(get("/v2/videos/{id}", seedVideo())
                        .header("Authorization", "Bearer " + jwt.issueAccessToken(USER).value()))
                .andReturn().getResponse();
        assertThat(response.getStatus()).isEqualTo(200);
        assertThat(mapper.readTree(response.getContentAsString()).path("playback_url").isNull()).isTrue();
    }

    /** 보관함의 영상 하나. 스토리지가 없어도 기록은 열고 재생 주소만 비운다. */
    private UUID seedVideo() {
        UUID video = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO videos(id,user_id,object_key,content_type,byte_size,duration_ms)
                VALUES (?,?,?,'video/mp4',1000,12000)
                """, video, USER, "videos/" + video + ".mp4");
        return video;
    }

    /**
     * 기동 시 publisher 가 심어 둔 최신 동의 문서 전부에 granted 를 남긴다.
     *
     * <p>말마다 행이 하나씩 있지만 <b>문서의 신원은 한국어 행이 쥔다</b> (SOMA-544) —
     * 서비스가 내주는 문서 번호가 그것이라, 동의도 그 번호로 남겨야 맞는다.
     */
    private void grantAllConsents() {
        jdbc.query("SELECT DISTINCT ON (type) id FROM consent_documents"
                        + " WHERE locale = 'ko'"
                        + " ORDER BY consent_documents.type,"
                        + " consent_documents.published_at DESC, consent_documents.id DESC",
                (rs, row) -> rs.getObject(1, UUID.class))
                .forEach(documentId -> jdbc.update("""
                        INSERT INTO user_consents(id,user_id,document_id,action)
                        VALUES (?,?,?,'granted')
                        """, UUID.randomUUID(), USER, documentId));
    }
}
