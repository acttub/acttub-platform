package com.acttub.actingapi.feature.report.adapter.web;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.UUID;

import com.acttub.actingapi.feature.auth.app.JwtService;
import com.acttub.actingapi.feature.report.adapter.db.ReportFixtures;
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
@org.springframework.test.context.ActiveProfiles("legacy-practice-test")
@org.springframework.context.annotation.Import(com.acttub.actingapi.support.LegacyPracticeApiFixture.class)
@AutoConfigureMockMvc
class ReportNoStorageIT {
    private static final UUID USER =
            UUID.fromString("00000000-0000-4000-8000-000000000503");
    private static final OffsetDateTime NOW =
            OffsetDateTime.of(2026, 8, 8, 2, 3, 4, 567890000, ZoneOffset.UTC);

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
        // reports 라우터는 app.py 에서 rate_limited_user 자리에 consented_user 를 받는다 —
        // 동의를 주지 않으면 storage 미설정(503)에 닿기 전에 403 consent_required 가 난다.
        grantAllConsents();
    }

    @Test
    void existingReportWithoutConfiguredStorageReturnsExact503Contract() throws Exception {
        UUID practice = seedLegacyPractice();
        UUID sourceHandoffId = new ReportFixtures(jdbc).insertHandoff(practice);
        jdbc.update("""
                INSERT INTO practice_reports (
                    id,practice_session_id,report_type,report_json,source_handoff_id,created_at
                ) VALUES (?, ?, 'analysis',
                    '{"report_type":"analysis","title":"리포트"}'::jsonb, ?, ?)
                """, UUID.randomUUID(), practice, sourceHandoffId, NOW);

        var response = mvc.perform(get("/v2/legacy-test-reports/{id}", practice)
                        .header("Authorization", "Bearer " + jwt.issueAccessToken(USER).value()))
                .andReturn().getResponse();
        assertThat(response.getStatus()).isEqualTo(503);
        assertThat(mapper.readTree(response.getContentAsString()))
                .isEqualTo(mapper.readTree("{\"detail\":\"storage_not_configured\"}"));
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

    /** 옛 리포트가 매달릴 옛 연습 하나. 옛 쓰기 경로는 내렸지만 옛 자료와 그 읽기는 남아 있다(§6-15). */
    private UUID seedLegacyPractice() {
        UUID upload = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO upload_intents (
                    id,user_id,status,storage_provider,object_key,mime_type,size_bytes,expires_at
                ) VALUES (?,?,'finalized','s3','video.mp4','video/mp4',1,?)
                """, upload, USER, NOW.plusDays(1));
        UUID practice = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO practice_sessions (
                    id,user_id,upload_intent_id,status,situation,character_context,goal,
                    blockage_kind,sub_branch
                ) VALUES (?, ?, ?, 'analyzed', '상황', '인물', '목표',
                    '분석', '캐릭터 분석')
                """, practice, USER, upload);
        return practice;
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
