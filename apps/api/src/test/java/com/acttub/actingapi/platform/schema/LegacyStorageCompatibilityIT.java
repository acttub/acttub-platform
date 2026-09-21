package com.acttub.actingapi.platform.schema;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.URI;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.UUID;

import com.acttub.actingapi.ActingApiApplication;
import com.acttub.actingapi.feature.auth.app.JwtService;
import com.acttub.actingapi.feature.analysis.app.AnalysisStore;
import com.acttub.actingapi.feature.analysis.app.AnalysisResult;
import com.acttub.actingapi.feature.practice.app.PracticeSessionRepository;
import com.acttub.actingapi.integration.observation.ObservationItem;
import com.acttub.actingapi.integration.observation.ObservationPack;
import com.acttub.actingapi.support.AccountFixtures;
import com.acttub.actingapi.support.DefaultClientHeader;
import com.acttub.actingapi.support.PostgresContainerSupport;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.boot.web.servlet.context.ServletWebServerApplicationContext;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

/** 구형 저장 구조와의 결합을 기동·HTTP·실제 PostgreSQL 경계에서 검증한다. */
class LegacyStorageCompatibilityIT {
    private static final ObjectMapper MAPPER = new ObjectMapper();

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void currentFlowsPreserveOldDataAndWorkWithoutRetiredStorage(boolean removeRetiredStorage) throws Exception {
        String url = PostgresContainerSupport.createDatabase("legacy_storage_" + removeRetiredStorage);
        String username = PostgresContainerSupport.POSTGRES.getUsername();
        String password = PostgresContainerSupport.POSTGRES.getPassword();
        Flyway.configure().dataSource(url, username, password).load().migrate();
        JdbcTemplate jdbc = new JdbcTemplate(new DriverManagerDataSource(url, username, password));

        UUID user = UUID.randomUUID();
        UUID upload = UUID.randomUUID();
        UUID historical = seedHistory(jdbc, user, upload);
        Map<String, Object> before = historicalValues(jdbc, user, historical);
        if (removeRetiredStorage) {
            // 배포 마이그레이션이 아니다. 이 테스트만의 DB에서 코드 의존이 끊겼음을 반증한다.
            jdbc.execute("DROP TABLE reports");
            jdbc.execute("""
                    ALTER TABLE summaries DROP COLUMN observation, DROP COLUMN summary,
                        DROP COLUMN intent_alignment, DROP COLUMN key_moment, DROP COLUMN key_dimension
                    """);
            jdbc.execute("ALTER TABLE practice_sessions DROP COLUMN subtext");
            jdbc.execute("ALTER TABLE users DROP COLUMN role");
            // 커뮤니티는 1.0.0 에서 코드를 내리고 테이블만 남겼다. 한 문장이라 서로의 FK 가 막지 않는다.
            jdbc.execute("""
                    DROP TABLE community_reports, community_post_likes, community_anonymous_aliases,
                        community_comments, community_blocks, community_posts, community_categories
                    """);
        }

        try (var context = new SpringApplicationBuilder(ActingApiApplication.class).run(
                "--spring.datasource.url=" + url,
                "--spring.datasource.username=" + username,
                "--spring.datasource.password=" + password,
                "--JWT_SECRET=test-secret", "--server.port=0",
                "--ANALYSIS_WORKER_ENABLED=false",
                "--GEMINI_API_KEY=test-not-a-real-key")) {
            int port = ((ServletWebServerApplicationContext) context).getWebServer().getPort();
            jdbc.update("""
                    INSERT INTO user_consents(id,user_id,document_id,action,occurred_at)
                    SELECT gen_random_uuid(), ?, id, 'granted', now() FROM consent_documents
                    """, user);
            AccountFixtures.completeProfile(jdbc, user);
            String bearer = "Bearer " + context.getBean(JwtService.class).issueAccessToken(user).value();
            assertThat(get(port, "/health", bearer).path("status").asText()).isEqualTo("ok");
            // 옛 쓰기 경로(`POST /v2/practice-sessions`)는 내렸다(§6-15). 옛 자료는 그대로 심고 <b>호환 읽기
            // 경로</b>로 읽는다 — 이 시험의 주제가 "현재 흐름이 옛 자료를 그대로 보여 주는가" 이기 때문이다.
            String session = seedPending(jdbc, user, upload).toString();
            assertThat(get(port, "/v2/practices/" + session + "/status", bearer)
                    .path("stage").asText()).isEqualTo("analyzing");
            assertThat(practiceIds(get(port, "/v2/practices", bearer)))
                    .containsExactlyInAnyOrder(session, historical.toString());
            assertThat(get(port, "/v2/reports", bearer).path("reports"))
                    .singleElement().satisfies(item -> {
                        assertThat(item.path("practice_session_id").asText()).isEqualTo(historical.toString());
                        assertThat(item.path("title").asText()).isEqualTo("현재 연습 노트");
                    });

            // 분석 저장 Port는 실제 JPA INSERT·Lease 완료를 사용한다. 외부 모델 호출은 없다.
            AnalysisStore store = context.getBean(AnalysisStore.class);
            UUID lease = UUID.randomUUID();
            UUID operation = store.claimNext(lease, Duration.ofMinutes(1), Instant.now());
            assertThat(operation).isNotNull();
            ObservationPack pack = new ObservationPack("새 장면", List.of(
                    new ObservationItem(0, 500, "새 관찰", "기다려", "호흡", 0.8)), List.of("새 불확실"));
            assertThat(store.complete(operation, lease, new AnalysisResult(pack, true, 900),
                    "fixture-model", Instant.now())).isNotNull();
            assertThat(get(port, "/v2/practices/" + session + "/status", bearer)
                    .path("stage").asText()).as("분석이 끝나면 대화로 넘어간다").isEqualTo("conversing");
            PracticeSessionRepository practices = context.getBean(PracticeSessionRepository.class);
            assertThat(practices.detail(user, UUID.fromString(session)).summary().observations())
                    .singleElement().satisfies(item -> assertThat(item.label()).isEqualTo("새 관찰"));
            assertThat(practices.detail(user, historical).summary().observations())
                    .singleElement().satisfies(item -> assertThat(item.label()).isEqualTo("과거 관찰"));
            assertThat(jdbc.queryForMap("SELECT model,was_compressed FROM summaries WHERE session_id=?",
                    UUID.fromString(session)))
                    .containsEntry("model", "fixture-model").containsEntry("was_compressed", true);
            if (!removeRetiredStorage) {
                assertThat(historicalValues(jdbc, user, historical)).isEqualTo(before);
            }
            assertThat(jdbc.queryForObject("SELECT text FROM transcripts WHERE session_id=?", String.class, historical))
                    .isEqualTo("과거 전체 대사");
        }
    }

    private UUID seedHistory(JdbcTemplate jdbc, UUID user, UUID upload) {
        UUID practice = UUID.randomUUID();
        UUID coach = UUID.randomUUID();
        UUID handoff = UUID.randomUUID();
        jdbc.update("INSERT INTO users(id,status,role) VALUES (?,'active','admin')", user);
        jdbc.update("""
                INSERT INTO upload_intents(id,user_id,status,storage_provider,object_key,
                    mime_type,size_bytes,expires_at)
                VALUES (?,?,'finalized','s3','legacy-compatibility.mp4','video/mp4',12,now())
                """, upload, user);
        jdbc.update("""
                INSERT INTO practice_sessions(id,user_id,upload_intent_id,status,situation,character_context,
                    subtext,blockage_kind,sub_branch,goal)
                VALUES (?,?,?,'analyzed','과거 상황','과거 인물','보존할 서브텍스트','분석','대사 분석','과거 목표')
                """, practice, user, upload);
        jdbc.update("""
                INSERT INTO summaries(session_id,observation,summary,intent_alignment,key_moment,key_dimension,
                    model,was_compressed,raw,observations_json,uncertainties_json)
                VALUES (?,'{"legacy":true}'::jsonb,'옛 요약','옛 의도','옛 순간','옛 차원','old-model',true,'{}'::jsonb,
                    '[{"start_ms":0,"end_ms":500,"label":"과거 관찰","confidence":0.9}]'::jsonb,'[]'::jsonb)
                """, practice);
        jdbc.update("INSERT INTO transcripts(session_id,ord,text) VALUES (?,0,'과거 전체 대사')", practice);
        jdbc.update("""
                INSERT INTO coach_sessions(id,practice_session_id,status,conversation_summary,close_reason)
                VALUES (?,?,'closed','과거 대화 요약','user_ended')
                """, coach, practice);
        jdbc.update("""
                INSERT INTO reports(session_id,headline,biggest_problem,evidence,self_discovery,encouragement,next_step)
                VALUES (?,'구형 리포트','{"old":true}'::jsonb,'근거','발견','격려','다음')
                """, coach);
        jdbc.update("""
                INSERT INTO coaching_handoffs(id,coach_session_id,practice_session_id,branch_kind,handoff_json)
                VALUES (?,?,?,'analysis','{}'::jsonb)
                """, handoff, coach, practice);
        jdbc.update("""
                INSERT INTO practice_reports(practice_session_id,report_type,report_json,source_handoff_id)
                VALUES (?,'analysis','{"title":"현재 연습 노트"}'::jsonb,?)
                """, practice, handoff);
        jdbc.update("""
                INSERT INTO community_posts(category_id,author_id,title,body)
                SELECT id,?,'보존할 글','보존할 본문' FROM community_categories ORDER BY sort_order LIMIT 1
                """, user);
        return practice;
    }

    private Map<String, Object> historicalValues(JdbcTemplate jdbc, UUID user, UUID practice) {
        return Map.of(
                "user", jdbc.queryForMap("SELECT role FROM users WHERE id=?", user),
                "practice", jdbc.queryForMap("SELECT subtext FROM practice_sessions WHERE id=?", practice),
                "summary", jdbc.queryForMap("""
                        SELECT observation::text,summary,intent_alignment,key_moment,key_dimension,
                            model,was_compressed FROM summaries WHERE session_id=?
                        """, practice),
                "coach", jdbc.queryForMap("""
                        SELECT conversation_summary,close_reason FROM coach_sessions WHERE practice_session_id=?
                        """, practice),
                "report", jdbc.queryForObject("""
                        SELECT to_jsonb(report)::text FROM reports report JOIN coach_sessions coach
                            ON coach.id=report.session_id WHERE coach.practice_session_id=?
                        """, String.class, practice),
                "community", jdbc.queryForObject(
                        "SELECT to_jsonb(post)::text FROM community_posts post WHERE author_id=?",
                        String.class, user));
    }

    private JsonNode get(int port, String path, String bearer) throws Exception {
        return send(HttpRequest.newBuilder(URI.create("http://localhost:" + port + path))
                .header(DefaultClientHeader.NAME, DefaultClientHeader.APP)
                .header("Authorization", bearer).GET().build(), 200);
    }

    /** 분석을 기다리는 옛 세션 하나. 옛 쓰기 경로가 내려간 뒤에도 옛 자료는 이렇게 존재한다. */
    private UUID seedPending(JdbcTemplate jdbc, UUID user, UUID upload) {
        UUID session = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO practice_sessions(id,user_id,upload_intent_id,status,situation,
                                              character_context,blockage_kind,sub_branch,goal)
                VALUES (?,?,?,'analyzing','상황','인물','분석','대사 분석','목표')
                """, session, user, upload);
        jdbc.update("""
                INSERT INTO external_operations(id,session_id,user_id,request_id,kind,status,
                                                request_fingerprint)
                VALUES (gen_random_uuid(),?,?,gen_random_uuid(),'analyze','pending',?)
                """, session, user, "a".repeat(64));
        return session;
    }

    /** 묶음 목록을 회차 id 로 편다 — 옛 묶음도 호환 읽기가 같은 모양으로 낸다(02-practice ②). */
    private static List<String> practiceIds(JsonNode groups) {
        List<String> ids = new java.util.ArrayList<>();
        groups.path("groups").forEach(group ->
                group.path("practices").forEach(practice -> ids.add(practice.path("id").asText())));
        return ids;
    }

    private JsonNode send(HttpRequest request, int expectedStatus) throws Exception {
        try (HttpClient client = HttpClient.newHttpClient()) {
            HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
            assertThat(response.statusCode()).as(response.body()).isEqualTo(expectedStatus);
            return MAPPER.readTree(response.body());
        }
    }
}
