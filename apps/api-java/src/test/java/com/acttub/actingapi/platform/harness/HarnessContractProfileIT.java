package com.acttub.actingapi.platform.harness;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.UUID;

import com.acttub.actingapi.analysis.AnalysisProcessor;
import com.acttub.actingapi.platform.security.FixedWindowRateLimiter;
import com.acttub.actingapi.auth.JwtService;
import com.acttub.actingapi.media.GeminiVideoCompressor;
import com.acttub.actingapi.observation.ObservationAnalyzer;
import com.acttub.actingapi.support.PostgresContainerSupport;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.ApplicationContext;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;

// 🔎 **`GEMINI_API_KEY` 를 일부러 비운다.** `src/test/resources/application.properties` 가
// 키를 채워 주는 바람에 이 IT 는 초록인 채로 **격리 기동만 죽어 있었다** — 실제 하네스
// 인스턴스는 `-Dacttub.dotenv.enabled=false` 로 떠서 키를 받을 곳이 없기 때문이다.
// 여기서 비워야 이 IT 가 하네스와 같은 조건을 재현한다.
@SpringBootTest(properties = {
        "JWT_SECRET=contract-harness-jwt-secret",
        "GEMINI_API_KEY="})
@AutoConfigureMockMvc
@ActiveProfiles("contract")
class HarnessContractProfileIT {
    private static final ObjectMapper JSON = new ObjectMapper();

    private static final UUID USER = id(1);
    private static final UUID UPLOAD_1 = id(11);
    private static final UUID UPLOAD_2 = id(12);
    private static final UUID PRACTICE_1 = id(21);
    private static final UUID PRACTICE_2 = id(22);
    private static final UUID COACH_1 = id(31);
    private static final UUID COACH_2 = id(32);
    private static final UUID HANDOFF_1 = id(41);
    private static final UUID HANDOFF_2 = id(42);
    private static final UUID REFRESH_1 = id(51);
    private static final UUID REFRESH_2 = id(52);
    private static final UUID REQUEST_1 = id(61);
    private static final UUID REQUEST_2 = id(62);

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        String name = PostgresContainerSupport.createDatabaseName("harness_contract");
        String url = PostgresContainerSupport.jdbcUrlFor(name);
        Flyway.configure()
                .dataSource(
                        url,
                        PostgresContainerSupport.POSTGRES.getUsername(),
                        PostgresContainerSupport.POSTGRES.getPassword())
                .load()
                .migrate();
        registry.add("spring.datasource.url", () -> url);
        registry.add("spring.datasource.username", PostgresContainerSupport.POSTGRES::getUsername);
        registry.add("spring.datasource.password", PostgresContainerSupport.POSTGRES::getPassword);
        registry.add("HARNESS_SCHEMA", () -> "public");
    }

    @Autowired
    MockMvc mvc;

    @Autowired
    JdbcTemplate jdbc;

    @Autowired
    OffsettableClock clock;

    @Autowired
    FixedWindowRateLimiter rateLimiter;

    @Autowired
    JwtService jwt;

    @Autowired
    ApplicationContext context;

    @BeforeEach
    void reset() throws Exception {
        control("reset-state", "{}");
        jdbc.execute("TRUNCATE TABLE users RESTART IDENTITY CASCADE");
    }

    /**
     * 이 클래스가 뜬 것만으로 "키 없이 기동한다"는 절반이 증명된다. 나머지 절반은
     * <b>진짜 분석 체인이 세워지지 않는다</b>는 것이다 — {@code @Primary} 는 주입 경합에서만
     * 이길 뿐 빈 생성을 막지 않으므로, 그것이 서 버리면 {@code GEMINI_API_KEY} 를 다시
     * 요구하게 된다.
     */
    @Test
    void contractProfileBuildsNoRealAnalysisChain() {
        assertThat(context.getBeanNamesForType(AnalysisProcessor.class))
                .containsExactly("contractAnalysisProcessor");
        assertThat(context.getBeanNamesForType(ObservationAnalyzer.class)).isEmpty();
        assertThat(context.getBeanNamesForType(GeminiVideoCompressor.class)).isEmpty();
    }

    @Test
    void contractProfileLogsInWithSharedProviderFixture() throws Exception {
        var response = mvc.perform(post("/v2/auth/login")
                        .contentType("application/json")
                        .content("""
                                {
                                  "provider": "google",
                                  "id_token": "harness-token-new-actor"
                                }
                                """))
                .andReturn().getResponse();

        assertThat(response.getStatus()).isEqualTo(200);
        JsonNode body = JSON.readTree(response.getContentAsString());
        assertThat(body.at("/user/email").textValue()).isEqualTo("new-actor@harness.test");
    }

    @Test
    void contractProfileMapsEveryProviderFixtureFailureBranch() throws Exception {
        assertLoginError("google", "harness-token-invalid", 401, "invalid_provider_token");
        assertLoginError("apple", "harness-token-new-actor", 503, "provider_not_configured");
        assertLoginError("kakao", "harness-token-new-actor", 400, "unsupported_provider");
    }

    @Test
    void contractClientHostHeaderSeparatesAuthenticationRateLimitKeys() throws Exception {
        for (int index = 0; index < 60; index++) {
            assertThat(loginFrom("testclient")).isEqualTo(200);
        }
        assertThat(loginFrom("testclient")).isEqualTo(429);
        // 🔎 **다른 유저로** 확인해야 IP 키만 본다. 유저 레이트리밋도 60/분이라 같은
        // 계정으로 60번을 쓰면 IP 를 바꿔도 유저 키가 이미 소진돼 429 가 난다 —
        // 그러면 이 테스트가 헤더의 효과를 판정하지 못한다.
        assertThat(loginFrom("10.0.0.9", "harness-token-second-actor")).isEqualTo(200);

        // 같은 헤더가 제어 표면의 loopback 제한을 우회할 수는 없다.
        assertThat(mvc.perform(post("/__harness/stub-state")
                        .header(ContractClientHostFilter.HEADER, "203.0.113.10")
                        .contentType("application/json")
                        .content("{}"))
                .andReturn().getResponse().getStatus()).isEqualTo(200);
    }

    @Test
    void controlsAdvanceResetAndRejectUnknownNames() throws Exception {
        assertThat(control("advance-clock", "{\"seconds\":1.25}"))
                .isEqualTo(JSON.readTree("{\"offset_sec\":1.25}"));
        assertThat(control("advance-clock", "{\"seconds\":2.75}"))
                .isEqualTo(JSON.readTree("{\"offset_sec\":4.0}"));

        String limiterKey = "contract-test-caller";
        assertThat(rateLimiter.allow(limiterKey, 1)).isTrue();
        assertThat(rateLimiter.allow(limiterKey, 1)).isFalse();

        assertThat(control("reset-state", "{}"))
                .isEqualTo(JSON.readTree("{\"reset\":true}"));
        assertThat(control("advance-clock", "{\"seconds\":0}"))
                .isEqualTo(JSON.readTree("{\"offset_sec\":0.0}"));
        assertThat(rateLimiter.allow(limiterKey, 1)).isTrue();

        var response = mvc.perform(post("/__harness/not-a-control")
                        .contentType("application/json")
                        .content("{}"))
                .andReturn().getResponse();
        assertThat(response.getStatus()).isEqualTo(404);
        assertThat(JSON.readTree(response.getContentAsString()))
                .isEqualTo(JSON.readTree("{\"detail\":\"unknown control: not-a-control\"}"));
    }

    @Test
    void workerSweepAndStubControlsExposeTheRemainingContractSurface() throws Exception {
        assertThat(control("run-worker-once", "{}"))
                .isEqualTo(JSON.readTree("{\"processed\":0}"));
        assertThat(control("run-sweep", "{}"))
                .isEqualTo(JSON.readTree(
                        "{\"expired_uploads\":0,\"exhausted_operations\":0}"));

        JsonNode state = control("stub-state", "{}");
        assertThat(state.fieldNames()).toIterable().containsExactly(
                "coach_generate", "report_generate", "analyzer", "s3");
        assertThat(state.at("/coach_generate/budget").asInt()).isEqualTo(24);
        assertThat(state.at("/report_generate/budget").asInt()).isEqualTo(12);
        for (String name : java.util.List.of("coach_generate", "report_generate")) {
            assertThat(state.at("/" + name).fieldNames()).toIterable().containsExactly(
                    "calls", "remaining", "budget", "blocked", "in_block",
                    "in_block_count", "timed_out");
        }
        assertThat(state.at("/analyzer/calls").isIntegralNumber()).isTrue();
        assertThat(state.at("/s3/calls").isObject()).isTrue();

        assertThat(control("stub-state", "{\"release\":true}"))
                .isNotNull();
        assertThat(control("stub-state", "{\"rearm\":true,\"stub\":\"coach_generate\"}"))
                .isNotNull();
    }

    @Test
    void controlsRejectNonLoopbackCallers() throws Exception {
        var response = mvc.perform(post("/__harness/stub-state")
                        .with(request -> {
                            request.setRemoteAddr("203.0.113.10");
                            return request;
                        })
                        .contentType("application/json")
                        .content("{}"))
                .andReturn().getResponse();
        assertThat(response.getStatus()).isEqualTo(404);
    }

    @Test
    void runWorkerOnceUsesFixtureAnalyzerAndCommitsAnalysisAtomically() throws Exception {
        OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);
        jdbc.update("INSERT INTO users(id, status) VALUES (?, 'active'::user_status_t)", USER);
        jdbc.update("""
                INSERT INTO upload_intents(
                    id, user_id, status, storage_provider, object_key, mime_type,
                    size_bytes, duration_ms, etag, expires_at, finalized_at)
                VALUES (?, ?, 'finalized'::upload_status_t, 's3', ?, 'video/mp4',
                        4096, 1000, ?, ?, ?)
                """, UPLOAD_1, USER, "users/contract/uploads/take.mp4",
                "\"9f86d081884c7d659a2feaa0c55ad015\"", now.plusHours(1), now);
        jdbc.update("""
                INSERT INTO practice_sessions(
                    id, user_id, upload_intent_id, status, situation,
                    character_context, blockage_kind, sub_branch, goal,
                    created_at, updated_at)
                VALUES (?, ?, ?, 'analyzing'::practice_status_t, '상황',
                        '인물', '분석', '대사 분석', '목표', ?, ?)
                """, PRACTICE_1, USER, UPLOAD_1, now, now);
        jdbc.update("""
                INSERT INTO external_operations(
                    session_id, user_id, request_id, kind, status,
                    request_fingerprint, created_at, updated_at)
                VALUES (?, ?, ?, 'analyze'::operation_kind_t,
                        'pending'::operation_status_t, ?, ?, ?)
                """, PRACTICE_1, USER, REQUEST_1, "a".repeat(64), now, now);

        assertThat(control("run-worker-once", "{}"))
                .isEqualTo(JSON.readTree("{\"processed\":1}"));

        assertThat(jdbc.queryForObject(
                "SELECT status::text FROM external_operations WHERE request_id=?",
                String.class, REQUEST_1)).isEqualTo("succeeded");
        assertThat(jdbc.queryForObject(
                "SELECT status::text FROM practice_sessions WHERE id=?",
                String.class, PRACTICE_1)).isEqualTo("analyzed");
        assertThat(jdbc.queryForObject(
                "SELECT count(*) FROM summaries WHERE session_id=?",
                Integer.class, PRACTICE_1)).isEqualTo(1);
        assertThat(jdbc.queryForList(
                "SELECT text FROM transcripts WHERE session_id=? ORDER BY ord",
                String.class, PRACTICE_1)).containsExactly(
                        "지금 놓치면 끝이야", "돌아서지 마");
    }

    @Test
    void jwtClockIsNotMovedByTheHarnessOffset() throws Exception {
        // 🔎 **JWT 는 `advance-clock` 에 딸려가지 않는다.** 원본 하네스 wrapper 가
        // `JwtService(cfg.JWT_SECRET)` 로 **시계를 주입하지 않고** 레이트리밋 monotonic 과
        // 워커에 넘기는 시각만 앞당기기 때문이다.
        //
        // 뒤집으면 시나리오가 시계를 앞당기는 순간 액세스 토큰(TTL 30분)이 만료돼
        // 뒤따르는 요청이 전부 401 이 된다 — `worker-failure` 가 3시간을 앞당긴 뒤
        // status 조회에서 실제로 그렇게 죽었다. M2 는 하네스가 java 를 구동하지 못하던
        // 시점이라 이 가정이 검증된 적이 없었다.
        String token = jwt.issueAccessToken(USER).value();
        control("advance-clock", "{\"seconds\":1801}");
        assertThat(jwt.decodeAccessToken(token).userId()).isEqualTo(USER);
    }

    @Test
    void dbProjectionMatchesPythonShapeOrderingAndNullVsAbsent() throws Exception {
        seedProjectionRows();
        control("advance-clock", "{\"seconds\":60}");

        JsonNode actual = control("db-projection", "{}");
        JsonNode expected = JSON.readTree("""
                {
                  "external_operations": [
                    {
                      "request_id": "00000000-0000-4000-8000-000000000061",
                      "kind": "analyze",
                      "status": "pending",
                      "attempt_count": 0,
                      "error_code": null,
                      "has_lease_token": false,
                      "lease_expired": null,
                      "practice_session_id": "00000000-0000-4000-8000-000000000021",
                      "has_response_payload": false
                    },
                    {
                      "request_id": "00000000-0000-4000-8000-000000000062",
                      "kind": "report",
                      "status": "running",
                      "attempt_count": 2,
                      "error_code": "retryable",
                      "has_lease_token": true,
                      "lease_expired": true,
                      "practice_session_id": "00000000-0000-4000-8000-000000000022",
                      "has_response_payload": true
                    }
                  ],
                  "coach_sessions": [
                    {
                      "id": "00000000-0000-4000-8000-000000000031",
                      "status": "open",
                      "close_reason": null,
                      "practice_session_id": "00000000-0000-4000-8000-000000000021",
                      "turn_count": 0
                    },
                    {
                      "id": "00000000-0000-4000-8000-000000000032",
                      "status": "closed",
                      "close_reason": "gap_stated",
                      "practice_session_id": "00000000-0000-4000-8000-000000000022",
                      "turn_count": 2
                    }
                  ],
                  "refresh_tokens": [
                    {
                      "index": 0,
                      "user_id": "00000000-0000-4000-8000-000000000001",
                      "revoked": false,
                      "has_replacement": true
                    },
                    {
                      "index": 1,
                      "user_id": "00000000-0000-4000-8000-000000000001",
                      "revoked": true,
                      "has_replacement": false
                    }
                  ],
                  "practice_sessions": [
                    {
                      "id": "00000000-0000-4000-8000-000000000021",
                      "status": "analyzed"
                    },
                    {
                      "id": "00000000-0000-4000-8000-000000000022",
                      "status": "created"
                    }
                  ],
                  "practice_reports": [
                    {
                      "practice_session_id": "00000000-0000-4000-8000-000000000022",
                      "report_type": "expression"
                    },
                    {
                      "practice_session_id": "00000000-0000-4000-8000-000000000021",
                      "report_type": "analysis"
                    }
                  ]
                }
                """);
        assertThat(actual).isEqualTo(expected);
        assertThat(actual.fieldNames()).toIterable().containsExactly(
                "external_operations",
                "coach_sessions",
                "refresh_tokens",
                "practice_sessions",
                "practice_reports");
        assertThat(actual.at("/external_operations/0").has("error_code")).isTrue();
        assertThat(actual.at("/external_operations/0/error_code").isNull()).isTrue();
        assertThat(actual.at("/coach_sessions/0").has("close_reason")).isTrue();
        assertThat(actual.at("/coach_sessions/0/close_reason").isNull()).isTrue();

        JsonNode included = control(
                "db-projection", "{\"include\":[\"practice_sessions\"]}");
        assertThat(included.fieldNames()).toIterable().containsExactly("practice_sessions");
        assertThat(included.has("external_operations")).isFalse();
    }

    private void seedProjectionRows() {
        OffsetDateTime t1 = OffsetDateTime.of(2026, 1, 1, 0, 0, 1, 0, ZoneOffset.UTC);
        OffsetDateTime t2 = t1.plusSeconds(1);
        OffsetDateTime t3 = t2.plusSeconds(1);
        OffsetDateTime t4 = t3.plusSeconds(1);

        jdbc.update("INSERT INTO users(id, status) VALUES (?, 'active'::user_status_t)", USER);
        insertUpload(UPLOAD_2, t2);
        insertUpload(UPLOAD_1, t1);
        insertPractice(PRACTICE_2, UPLOAD_2, "created", t2);
        insertPractice(PRACTICE_1, UPLOAD_1, "analyzed", t1);

        jdbc.update("""
                INSERT INTO coach_sessions(
                    id, status, close_reason, created_at, updated_at,
                    practice_session_id, conversation_summary)
                VALUES (?, 'closed'::session_status_t, 'gap_stated'::close_reason_t,
                        ?, ?, ?, '')
                """, COACH_2, t2, t2, PRACTICE_2);
        jdbc.update("""
                INSERT INTO coach_sessions(
                    id, status, close_reason, created_at, updated_at,
                    practice_session_id, conversation_summary)
                VALUES (?, 'open'::session_status_t, NULL, ?, ?, ?, '')
                """, COACH_1, t1, t1, PRACTICE_1);
        jdbc.update("""
                INSERT INTO coach_turns(session_id, turn_index, role, text, created_at)
                VALUES (?, 0, 'actor'::turn_role_t, '첫 턴', ?),
                       (?, 1, 'ai'::turn_role_t, '둘째 턴', ?)
                """, COACH_2, t2, COACH_2, t3);

        jdbc.update("""
                INSERT INTO external_operations(
                    session_id, user_id, request_id, kind, status, attempt_count,
                    request_fingerprint, lease_token, lease_expires_at, error_code,
                    response_payload, created_at, updated_at)
                VALUES (?, ?, ?, 'report'::operation_kind_t, 'running'::operation_status_t,
                        2, ?, ?, ?, 'retryable', '{}'::jsonb, ?, ?)
                """, PRACTICE_2, USER, REQUEST_2, "b".repeat(64), id(71),
                OffsetDateTime.now(ZoneOffset.UTC).plusSeconds(30), t2, t2);
        jdbc.update("""
                INSERT INTO external_operations(
                    session_id, user_id, request_id, kind, status, attempt_count,
                    request_fingerprint, lease_token, lease_expires_at, error_code,
                    response_payload, created_at, updated_at)
                VALUES (?, ?, ?, 'analyze'::operation_kind_t, 'pending'::operation_status_t,
                        0, ?, NULL, NULL, NULL, NULL, ?, ?)
                """, PRACTICE_1, USER, REQUEST_1, "a".repeat(64), t1, t1);

        jdbc.update("""
                INSERT INTO refresh_tokens(
                    id, user_id, token_hash, issued_at, expires_at, revoked_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """, REFRESH_2, USER, "2".repeat(64), t2, t4.plusDays(1), t4);
        jdbc.update("""
                INSERT INTO refresh_tokens(
                    id, user_id, replaced_by_id, token_hash, issued_at, expires_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """, REFRESH_1, USER, REFRESH_2, "1".repeat(64), t1, t4.plusDays(1));

        insertHandoff(HANDOFF_1, COACH_1, PRACTICE_1, t1);
        insertHandoff(HANDOFF_2, COACH_2, PRACTICE_2, t2);
        jdbc.update("""
                INSERT INTO practice_reports(
                    id, practice_session_id, report_type, report_json,
                    source_handoff_id, created_at)
                VALUES (?, ?, 'expression', '{}'::jsonb, ?, ?)
                """, id(81), PRACTICE_2, HANDOFF_2, t3);
        jdbc.update("""
                INSERT INTO practice_reports(
                    id, practice_session_id, report_type, report_json,
                    source_handoff_id, created_at)
                VALUES (?, ?, 'analysis', '{}'::jsonb, ?, ?)
                """, id(82), PRACTICE_1, HANDOFF_1, t4);
    }

    private void insertUpload(UUID id, OffsetDateTime createdAt) {
        jdbc.update("""
                INSERT INTO upload_intents(
                    id, user_id, status, storage_provider, object_key,
                    mime_type, size_bytes, created_at, expires_at)
                VALUES (?, ?, 'finalized'::upload_status_t, 's3', ?,
                        'video/mp4', 100, ?, ?)
                """, id, USER, "uploads/" + id, createdAt, createdAt.plusDays(1));
    }

    private void insertPractice(
            UUID id, UUID uploadId, String status, OffsetDateTime createdAt) {
        jdbc.update("""
                INSERT INTO practice_sessions(
                    id, user_id, upload_intent_id, status, situation,
                    character_context, blockage_kind, sub_branch, goal,
                    created_at, updated_at)
                VALUES (?, ?, ?, ?::practice_status_t, '상황',
                        '인물', '분석', '캐릭터 분석', '목표', ?, ?)
                """, id, USER, uploadId, status, createdAt, createdAt);
    }

    private void insertHandoff(
            UUID id, UUID coachId, UUID practiceId, OffsetDateTime createdAt) {
        jdbc.update("""
                INSERT INTO coaching_handoffs(
                    id, coach_session_id, practice_session_id,
                    branch_kind, handoff_json, created_at)
                VALUES (?, ?, ?, 'analysis', '{}'::jsonb, ?)
                """, id, coachId, practiceId, createdAt);
    }

    private JsonNode control(String name, String body) throws Exception {
        var response = mvc.perform(post("/__harness/" + name)
                        .contentType("application/json")
                        .content(body))
                .andReturn().getResponse();
        assertThat(response.getStatus()).isEqualTo(200);
        return JSON.readTree(response.getContentAsString());
    }

    private void assertLoginError(
            String provider,
            String idToken,
            int expectedStatus,
            String expectedDetail) throws Exception {
        String request = JSON.writeValueAsString(java.util.Map.of(
                "provider", provider,
                "id_token", idToken));
        var response = mvc.perform(post("/v2/auth/login")
                        .contentType("application/json")
                        .content(request))
                .andReturn().getResponse();

        assertThat(response.getStatus()).isEqualTo(expectedStatus);
        assertThat(JSON.readTree(response.getContentAsString()))
                .isEqualTo(JSON.readTree("{\"detail\":\"" + expectedDetail + "\"}"));
    }

    private int loginFrom(String host) throws Exception {
        return loginFrom(host, "harness-token-new-actor");
    }

    private int loginFrom(String host, String idToken) throws Exception {
        return mvc.perform(post("/v2/auth/login")
                        .header(ContractClientHostFilter.HEADER, host)
                        .contentType("application/json")
                        .content("""
                                {"provider":"google","id_token":"%s"}
                                """.formatted(idToken)))
                .andReturn().getResponse().getStatus();
    }

    private static UUID id(int suffix) {
        return UUID.fromString("00000000-0000-4000-8000-%012d".formatted(suffix));
    }
}
