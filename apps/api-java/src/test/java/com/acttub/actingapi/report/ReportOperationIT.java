package com.acttub.actingapi.report;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.catchThrowable;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.stream.Stream;

import com.acttub.actingapi.support.PostgresContainerSupport;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/**
 * 위험 함수 #1 {@code complete_report_operation} 이식 검증 (/SPEC.md §7-1, M0-spike.md E).
 *
 * <p><b>⚠ 대상 함수는 더 이상 존재하지 않는다.</b> {@code SOMA-302}(AI 3개 층 교체)가 리포트
 * 계층을 갈아엎으면서 {@code complete_report_operation} 은 {@code complete_practice_report_operation}
 * ({@code db/store.py}) 으로 대체됐고, 중복 판정도 <b>제약명 문자열 매칭에서
 * {@code ON CONFLICT (source_handoff_id) DO NOTHING RETURNING} 으로 단순해졌다.</b>
 * 구 {@code reports} 테이블은 스키마에 남아 있지만 파이썬 코드에서 참조가 0건이다.
 *
 * <p>그럼에도 이 스위트를 남겨 둔다 — M0 가 답하려던 질문은 "어느 함수인가"가 아니라
 * <b>"선언적 {@code @Transactional} 과 {@code TransactionTemplate} 중 무엇을 쓸 것인가"</b> 였고,
 * 그 결론은 대상 함수와 무관하게 성립한다. 실제 이식은 M3 에서 <b>새 함수를 기준으로</b> 다시 쓴다.
 * 자세한 경위는 {@code spec/M0-findings.md} 참조.
 *
 * <p>네 시나리오를 <b>두 가지 트랜잭션 관리 스타일</b>에 똑같이 돌린다.
 * 둘 다 통과해야 "스타일 선택은 취향"이라고 말할 수 있고, 그래야 findings 의 결론이 근거를 갖는다.
 *
 * <p>특히 중복 경로가 <b>둘</b>이라는 점을 놓치지 않는다.
 * 사전 SELECT 로 잡히는 경로와 INSERT 시점에 {@code reports_session_id_key} 로 터지는 경로는
 * 서로 다른 코드 경로이고, 바깥에서 보면 둘 다 {@code null} 이다.
 */
@SpringBootTest
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class ReportOperationIT {

    @DynamicPropertySource
    static void datasource(DynamicPropertyRegistry registry) {
        String database = PostgresContainerSupport.createDatabaseName("report_it");
        registry.add("spring.datasource.url", () -> PostgresContainerSupport.jdbcUrlFor(database));
        registry.add("spring.datasource.username", PostgresContainerSupport.POSTGRES::getUsername);
        registry.add("spring.datasource.password", PostgresContainerSupport.POSTGRES::getPassword);
    }

    /** 스타일이 달라도 시그니처는 같다. 테스트는 이 인터페이스만 본다. */
    interface CompleteReport {
        ReportCompletion apply(UUID operationId, UUID leaseToken, UUID coachSessionId,
                ActingReportPayload report, Instant now);
    }

    @Autowired
    JdbcTemplate jdbc;
    @Autowired
    ObjectMapper objectMapper;
    @Autowired
    ReportOperationService transactionTemplateStyle;
    @Autowired
    DeclarativeReportOperationService declarativeStyle;

    ReportFixtures fixtures;

    @BeforeEach
    void setUp() {
        fixtures = new ReportFixtures(jdbc);
    }

    Stream<Arguments> styles() {
        return Stream.of(
                Arguments.of("TransactionTemplate",
                        (CompleteReport) transactionTemplateStyle::completeReportOperation),
                Arguments.of("선언적 @Transactional 2층",
                        (CompleteReport) declarativeStyle::completeReportOperation));
    }

    // ---- 시나리오 1: 정상 ----

    @ParameterizedTest(name = "[{0}] 정상: payload 를 돌려주고 커밋한다")
    @MethodSource("styles")
    void happyPath(String style, CompleteReport complete) throws Exception {
        ReportFixtures.Scenario s = fixtures.create();

        ReportCompletion result = complete.apply(s.operationId(), s.leaseToken(), s.coachSessionId(),
                ReportFixtures.samplePayload(), ReportFixtures.fixedNow());

        assertThat(result).isNotNull();
        assertThat(result.report().headline()).isEqualTo("오늘 연기는 시선이 살아 있었다");
        assertThat(result.reportCount()).isEqualTo(1);

        // 커밋됐다 — 새 커넥션으로 읽어서 확인한다.
        assertThat(reportCountFor(s.coachSessionId())).isEqualTo(1);

        Map<String, Object> operation = operationRow(s.operationId());
        assertThat(operation.get("status")).isEqualTo("succeeded");
        assertThat(operation.get("lease_token")).isNull();
        assertThat(operation.get("lease_expires_at")).isNull();
        assertThat(operation.get("error_code")).isNull();
        // jsonb 는 키 순서와 공백을 보존하지 않는다(Postgres 가 정규화한다).
        // 문자열 비교가 아니라 파싱해서 본다 — 멱등 replay 의 canonical JSON(/SPEC.md §6 #12)과는
        // 별개 문제다. 그쪽은 fingerprint 계산용이고 이건 저장된 payload 다.
        ReportCompletion stored = objectMapper.readValue(
                String.valueOf(operation.get("response_payload")), ReportCompletion.class);
        assertThat(stored.reportCount()).isEqualTo(1);
        assertThat(stored.report()).isEqualTo(ReportFixtures.samplePayload());
    }

    // ---- 시나리오 2: 사전 존재 확인 ----

    @ParameterizedTest(name = "[{0}] 사전 존재 확인에 걸리면 예외 없이 null 이다")
    @MethodSource("styles")
    void preCheckDuplicateReturnsNull(String style, CompleteReport complete) {
        ReportFixtures.Scenario s = fixtures.create();
        // 같은 practice session 아래에 이미 리포트가 있다.
        fixtures.insertReportDirectly(s.coachSessionId());

        ReportCompletion result = complete.apply(s.operationId(), s.leaseToken(), s.coachSessionId(),
                ReportFixtures.samplePayload(), ReportFixtures.fixedNow());

        assertThat(result).isNull();
        // 리포트를 새로 만들지 않았다.
        assertThat(reportCountFor(s.coachSessionId())).isEqualTo(1);
        // 원본과 같이 operation 은 손대지 않는다 — 여전히 running 이다.
        assertThat(operationRow(s.operationId()).get("status")).isEqualTo("running");
    }

    // ---- 시나리오 3: INSERT 시점 reports_session_id_key 위반 ----

    @ParameterizedTest(name = "[{0}] 사전 확인을 통과했는데 reports_session_id_key 로 막히면 null 이다")
    @MethodSource("styles")
    void constraintViolationReturnsNull(String style, CompleteReport complete) {
        // 사전 확인이 <미스>해야 한다. 사전 확인은
        //   reports → coach_sessions → summaries → summaries.session_id = operation.session_id
        // 로 거슬러 올라가므로, operation 이 가리키는 practice session 과
        // coach session 이 매달린 practice session 이 다르면 통과한다.
        // 그 뒤 INSERT 가 reports.session_id 유니크에 걸린다.
        UUID userId = fixtures.insertUser();

        UUID practiceSessionA = fixtures.insertPracticeSession(userId);
        UUID coachSessionA = fixtures.insertCoachSessionFor(practiceSessionA);
        fixtures.insertReportDirectly(coachSessionA);

        UUID practiceSessionB = fixtures.insertPracticeSession(userId);
        UUID leaseToken = UUID.randomUUID();
        UUID operationId = fixtures.insertRunningReportOperation(practiceSessionB, userId, leaseToken);

        ReportCompletion result = complete.apply(operationId, leaseToken, coachSessionA,
                ReportFixtures.samplePayload(), ReportFixtures.fixedNow());

        // 예외가 아니라 null 이다.
        assertThat(result).isNull();
        assertThat(reportCountFor(coachSessionA)).isEqualTo(1);
        // 트랜잭션이 통째로 롤백됐다 — operation 은 여전히 running.
        assertThat(operationRow(operationId).get("status")).isEqualTo("running");
    }

    @Test
    @DisplayName("동시 실행: 한쪽만 payload 를 받고 다른 쪽은 null 이다 (진짜 경쟁 조건)")
    void concurrentCompletionsRaceOnTheUniqueIndex() throws Exception {
        UUID userId = fixtures.insertUser();
        UUID coachSession = fixtures.insertCoachSessionFor(
                fixtures.insertPracticeSession(userId));

        // 서로 다른 practice session 을 가리키는 두 operation.
        // FOR UPDATE 대상 행이 달라 직렬화되지 않고, 사전 확인도 둘 다 미스한다.
        UUID leaseA = UUID.randomUUID();
        UUID operationA = fixtures.insertRunningReportOperation(
                fixtures.insertPracticeSession(userId), userId, leaseA);
        UUID leaseB = UUID.randomUUID();
        UUID operationB = fixtures.insertRunningReportOperation(
                fixtures.insertPracticeSession(userId), userId, leaseB);

        CyclicBarrier barrier = new CyclicBarrier(2);
        Callable<ReportCompletion> callA = task(barrier, operationA, leaseA, coachSession);
        Callable<ReportCompletion> callB = task(barrier, operationB, leaseB, coachSession);

        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            Future<ReportCompletion> a = pool.submit(callA);
            Future<ReportCompletion> b = pool.submit(callB);
            ReportCompletion resultA = a.get();
            ReportCompletion resultB = b.get();

            assertThat(List.of(resultA == null, resultB == null))
                    .as("정확히 한쪽만 성공해야 한다")
                    .containsExactlyInAnyOrder(true, false);
        } finally {
            pool.shutdownNow();
        }

        assertThat(reportCountFor(coachSession)).isEqualTo(1);
    }

    private Callable<ReportCompletion> task(CyclicBarrier barrier, UUID operationId, UUID leaseToken,
            UUID coachSessionId) {
        return () -> {
            barrier.await();
            return transactionTemplateStyle.completeReportOperation(operationId, leaseToken,
                    coachSessionId, ReportFixtures.samplePayload(), ReportFixtures.fixedNow());
        };
    }

    // ---- 시나리오 4: 리스 소유권 상실 ----

    @ParameterizedTest(name = "[{0}] 리스를 뺏겼으면 전용 예외를 던지고 전부 롤백한다")
    @MethodSource("styles")
    void lostLeaseThrows(String style, CompleteReport complete) {
        ReportFixtures.Scenario s = fixtures.create();
        UUID stolenToken = UUID.randomUUID();

        assertThatThrownBy(() -> complete.apply(s.operationId(), stolenToken, s.coachSessionId(),
                ReportFixtures.samplePayload(), ReportFixtures.fixedNow()))
                .isInstanceOf(LeaseOwnershipException.class)
                .hasMessage("external operation lease is not owned");

        // 롤백돼서 리포트가 남지 않아야 한다.
        assertThat(reportCountFor(s.coachSessionId())).isZero();
        assertThat(operationRow(s.operationId()).get("status")).isEqualTo("running");
    }

    // ---- 부수 계약 ----

    @ParameterizedTest(name = "[{0}] operation 이 없거나 kind 가 report 가 아니면 각각의 예외")
    @MethodSource("styles")
    void guardsOnOperation(String style, CompleteReport complete) {
        assertThatThrownBy(() -> complete.apply(UUID.randomUUID(), UUID.randomUUID(),
                UUID.randomUUID(), ReportFixtures.samplePayload(), ReportFixtures.fixedNow()))
                .isInstanceOf(ExternalOperationNotFoundException.class);

        ReportFixtures.Scenario s = fixtures.create();
        jdbc.update("UPDATE external_operations SET kind = 'analyze'::operation_kind_t WHERE id = ?",
                s.operationId());
        assertThatThrownBy(() -> complete.apply(s.operationId(), s.leaseToken(), s.coachSessionId(),
                ReportFixtures.samplePayload(), ReportFixtures.fixedNow()))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("report result requires a report operation");
    }

    @Test
    @DisplayName("중복 판정은 제약명 문자열로 한다 — 다른 유니크 위반은 삼키지 않는다")
    void duplicateDetectionIsConstraintScoped() {
        UUID practiceSessionId = fixtures.insertPracticeSession(fixtures.insertUser());
        fixtures.insertSummary(practiceSessionId);

        // summaries_session_id_key 위반 (0004 가 만든 제약). reports_session_id_key 가 아니다.
        Throwable thrown = catchThrowable(() -> fixtures.insertSummary(practiceSessionId));

        assertThat(thrown).isNotNull();
        assertThat(DuplicateReportDetector.isDuplicateReport(thrown))
                .as("reports 가 아닌 제약이므로 중복 리포트로 오인하면 안 된다")
                .isFalse();
        assertThat(DuplicateReportDetector.violatesConstraint(thrown, "summaries_session_id_key"))
                .as("getConstraint() 가 실제로 제약명을 준다")
                .isTrue();
    }

    @Test
    @DisplayName("report_count 는 practice session 단위로 세고 숨긴 세션을 뺀다")
    void reportCountCountsVisiblePracticeSessions() {
        UUID userId = fixtures.insertUser();

        UUID hidden = fixtures.insertPracticeSession(userId);
        fixtures.insertReportDirectly(fixtures.insertCoachSessionFor(hidden));
        jdbc.update("UPDATE practice_sessions SET hidden_at = now() WHERE id = ?", hidden);

        UUID visible = fixtures.insertPracticeSession(userId);
        fixtures.insertReportDirectly(fixtures.insertCoachSessionFor(visible));

        UUID target = fixtures.insertPracticeSession(userId);
        UUID coachSession = fixtures.insertCoachSessionFor(target);
        UUID lease = UUID.randomUUID();
        UUID operation = fixtures.insertRunningReportOperation(target, userId, lease);

        ReportCompletion result = transactionTemplateStyle.completeReportOperation(operation, lease,
                coachSession, ReportFixtures.samplePayload(), ReportFixtures.fixedNow());

        assertThat(result).isNotNull();
        // 숨긴 것 1건은 빠지고, 보이는 것 1건 + 방금 만든 1건 = 2.
        assertThat(result.reportCount()).isEqualTo(2);
    }

    // ---- helpers ----

    private long reportCountFor(UUID coachSessionId) {
        Long count = jdbc.queryForObject("SELECT count(*) FROM reports WHERE session_id = ?",
                Long.class, coachSessionId);
        return count == null ? 0 : count;
    }

    private Map<String, Object> operationRow(UUID operationId) {
        return jdbc.queryForMap(
                "SELECT status::text AS status, lease_token, lease_expires_at, error_code, "
                        + "response_payload::text AS response_payload "
                        + "FROM external_operations WHERE id = ?",
                operationId);
    }
}
