package com.acttub.actingapi.feature.report.adapter.web;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.UUID;

import com.acttub.actingapi.feature.auth.app.JwtService;
import com.acttub.actingapi.feature.report.adapter.db.ReportFixtures;
import com.acttub.actingapi.support.PostgresContainerSupport;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest(properties = "JWT_SECRET=test-secret")
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
        // reports 라우터는 app.py 에서 rate_limited_user 자리에 consented_user 를 받는다 —
        // 동의를 주지 않으면 storage 미설정(503)에 닿기 전에 403 consent_required 가 난다.
        grantAllConsents();
    }

    @Test
    void existingReportWithoutConfiguredStorageReturnsExact503Contract() throws Exception {
        UUID practice = seedAnalyzedPractice();
        UUID sourceHandoffId = new ReportFixtures(jdbc).insertHandoff(practice);
        jdbc.update("""
                INSERT INTO practice_reports (
                    id,practice_session_id,report_type,report_json,source_handoff_id,created_at
                ) VALUES (?, ?, 'analysis',
                    '{"report_type":"analysis","title":"리포트"}'::jsonb, ?, ?)
                """, UUID.randomUUID(), practice, sourceHandoffId, NOW);

        var response = mvc.perform(get("/v2/reports/{id}", practice)
                        .header("Authorization", "Bearer " + jwt.issueAccessToken(USER).value()))
                .andReturn().getResponse();
        assertThat(response.getStatus()).isEqualTo(503);
        assertThat(mapper.readTree(response.getContentAsString()))
                .isEqualTo(mapper.readTree("{\"detail\":\"storage_not_configured\"}"));
    }

    /**
     * 같은 503 이 <b>세 경로</b>에서 난다. Java 는 {@code NoCredentialsError} 하나를
     * {@code ApiErrorAdvice} 가 받아 만들지만, <b>한 자리에서 만든다는 것이 경로마다 거기에
     *닿는다는 뜻은 아니다</b> — 업로드는 발급 전에, 연습 상세는 재생 주소를 만들 때 스토리지를
     * 건드린다.
     *
     * <p><b>계약 하네스에서 옮겨 온 기대값이다</b>(SOMA-403 2단계). 하네스는 이것을
     * {@code nostorage} 인스턴스로 네 케이스 돌렸다.
     */
    @Test
    void uploadIssueAndSessionDetailReturnTheSame503() throws Exception {
        UUID practice = seedAnalyzedPractice();
        String bearer = "Bearer " + jwt.issueAccessToken(USER).value();

        var upload = mvc.perform(post("/v2/uploads/intents")
                        .header("Authorization", bearer)
                        .contentType("application/json")
                        .content("{\"mime_type\":\"video/mp4\",\"size_bytes\":12}"))
                .andReturn().getResponse();
        assertThat(upload.getStatus()).isEqualTo(503);
        assertThat(mapper.readTree(upload.getContentAsString()))
                .isEqualTo(mapper.readTree("{\"detail\":\"storage_not_configured\"}"));

        var detail = mvc.perform(get("/v2/practice-sessions/{id}", practice)
                        .header("Authorization", bearer))
                .andReturn().getResponse();
        assertThat(detail.getStatus()).isEqualTo(503);
        assertThat(mapper.readTree(detail.getContentAsString()))
                .isEqualTo(mapper.readTree("{\"detail\":\"storage_not_configured\"}"));
    }

    /** 확정된 업로드 위에 분석까지 끝난 연습 하나를 세운다. */
    private UUID seedAnalyzedPractice() {
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

    /** 기동 시 publisher 가 심어 둔 최신 동의 문서 전부에 granted 를 남긴다. */
    private void grantAllConsents() {
        jdbc.query("SELECT DISTINCT ON (type) id FROM consent_documents"
                        + " ORDER BY consent_documents.type,"
                        + " consent_documents.published_at DESC, consent_documents.id DESC",
                (rs, row) -> rs.getObject(1, UUID.class))
                .forEach(documentId -> jdbc.update("""
                        INSERT INTO user_consents(id,user_id,document_id,action)
                        VALUES (?,?,?,'granted')
                        """, UUID.randomUUID(), USER, documentId));
    }
}
