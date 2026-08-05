package com.acttub.actingapi.report;

import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * {@code complete_report_operation} 의 <b>트랜잭션 안쪽 본문</b>
 * ({@code apps/api/acting-api/src/acting_api/db/store.py:1580-1643}).
 *
 * <p>여기에는 트랜잭션 어노테이션이 없다. 경계를 어디에 그을지는 호출자가 정한다 —
 * 그 선택을 비교하는 것이 M0-E 의 목적이기 때문이다
 * ({@link ReportOperationService} = TransactionTemplate,
 * {@link DeclarativeReportOperationService} = 선언적 2층).
 *
 * <p>{@code /SPEC.md} §5-4-2 의 "내부 헬퍼에 {@code @Transactional} 을 붙이지 않는다" 와도 같은 방향이다.
 */
@Component
public class ReportOperationWork {

    /** {@code models.py} 의 {@code OperationKind.REPORT}. */
    private static final String KIND_REPORT = "report";

    private final JdbcTemplate jdbc;
    private final ObjectMapper objectMapper;

    public ReportOperationWork(JdbcTemplate jdbc, ObjectMapper objectMapper) {
        this.jdbc = jdbc;
        this.objectMapper = objectMapper;
    }

    /**
     * 트랜잭션 안에서 실행돼야 한다. 중복(사전 확인)이면 {@code null} 을 돌려준다.
     * 커밋 경쟁으로 인한 중복은 여기서 잡지 않고 호출자에게 올려보낸다 — 그것이 원본 구조다.
     */
    public ReportCompletion execute(UUID operationId, UUID leaseToken, UUID coachSessionId,
            ActingReportPayload report, Instant now) {

        Map<String, Object> operation = loadOperation(operationId);
        if (!KIND_REPORT.equals(operation.get("kind"))) {
            throw new IllegalArgumentException("report result requires a report operation");
        }
        UUID practiceSessionId = (UUID) operation.get("session_id");
        UUID userId = (UUID) operation.get("user_id");

        // 원본과 같은 락 순서: practice_sessions 를 먼저 잡고 reports 를 쓴다 (/SPEC.md §6 #11).
        lockPracticeSession(practiceSessionId);

        if (existingReportId(practiceSessionId) != null) {
            // 경로 (2): 사전 SELECT 로 잡히는 중복. 예외 없이 null.
            return null;
        }

        // 경로 (3)의 진입점. 여기서 23505 가 터지면 트랜잭션은 abort 되고 호출자가 받는다.
        insertReport(coachSessionId, report);

        ReportCompletion payload = new ReportCompletion(report, reportCount(userId));

        if (!finishExternalOperation(operationId, leaseToken, payload, now)) {
            throw new LeaseOwnershipException("external operation lease is not owned");
        }
        return payload;
    }

    private Map<String, Object> loadOperation(UUID operationId) {
        List<Map<String, Object>> rows = jdbc.queryForList(
                "SELECT id, session_id, user_id, kind::text AS kind, status::text AS status "
                        + "FROM external_operations WHERE id = ?",
                operationId);
        if (rows.isEmpty()) {
            throw new ExternalOperationNotFoundException("external operation not found");
        }
        return rows.get(0);
    }

    private void lockPracticeSession(UUID practiceSessionId) {
        List<UUID> found = jdbc.queryForList(
                "SELECT id FROM practice_sessions WHERE id = ? FOR UPDATE",
                UUID.class, practiceSessionId);
        if (found.isEmpty()) {
            throw new PracticeSessionNotFoundException("practice session not found");
        }
    }

    /**
     * 이 practice session 에 이미 리포트가 있는지 본다.
     * {@code reports → coach_sessions → summaries → summaries.session_id} 로 거슬러 올라간다.
     */
    private UUID existingReportId(UUID practiceSessionId) {
        List<UUID> rows = jdbc.queryForList(
                "SELECT r.id FROM reports r "
                        + "JOIN coach_sessions cs ON r.session_id = cs.id "
                        + "JOIN summaries s ON cs.summary_id = s.id "
                        + "WHERE s.session_id = ? LIMIT 1",
                UUID.class, practiceSessionId);
        return rows.isEmpty() ? null : rows.get(0);
    }

    private void insertReport(UUID coachSessionId, ActingReportPayload report) {
        jdbc.update(
                "INSERT INTO reports (id, session_id, headline, biggest_problem, evidence, "
                        + "self_discovery, encouragement, next_step, comparison) "
                        + "VALUES (?, ?, ?, ?::jsonb, ?, ?, ?, ?, ?)",
                UUID.randomUUID(),
                coachSessionId,
                report.headline(),
                toJson(report.biggestProblem()),
                report.evidence(),
                report.selfDiscovery(),
                report.encouragement(),
                report.nextStep(),
                report.comparison());
    }

    /**
     * 목록·서수와 같은 단위(practice_session 별 1건)로 센다.
     *
     * <p><b>FROM 앵커는 {@code reports} 다</b> ({@code store.py:1310-1327} 의 주석).
     * count 컬럼이 {@code practice_sessions} 만 참조하므로 앵커를 명시하지 않으면
     * {@code practice_sessions} 가 FROM 에 두 번 들어가고 {@code reports} 가 빠져
     * Postgres 가 "missing FROM-clause entry for table reports" 로 거부한다.
     */
    private long reportCount(UUID userId) {
        Long count = jdbc.queryForObject(
                "SELECT count(DISTINCT ps.id) FROM reports r "
                        + "JOIN coach_sessions cs ON r.session_id = cs.id "
                        + "JOIN summaries s ON cs.summary_id = s.id "
                        + "JOIN practice_sessions ps ON s.session_id = ps.id "
                        + "WHERE ps.user_id = ? AND ps.hidden_at IS NULL",
                Long.class, userId);
        return count == null ? 0L : count;
    }

    /**
     * {@code _finish_external_operation} ({@code store.py:1807}) 대응.
     *
     * <p>rowcount 가 0 이면 리스를 이미 뺏겼다는 뜻이다. lease 만료 자체는 조건에 없다 —
     * "만료됐지만 아직 재선점 안 됨"은 완료를 허용하는 것이 확정 계약이다 (/SPEC.md §5-7).
     */
    private boolean finishExternalOperation(UUID operationId, UUID leaseToken,
            ReportCompletion payload, Instant now) {
        int updated = jdbc.update(
                "UPDATE external_operations SET status = 'succeeded'::operation_status_t, "
                        + "response_payload = ?::jsonb, error_code = NULL, lease_token = NULL, "
                        + "lease_expires_at = NULL, updated_at = ? "
                        + "WHERE id = ? AND status = 'running'::operation_status_t AND lease_token = ?",
                toJson(payload),
                OffsetDateTime.ofInstant(now, ZoneOffset.UTC),
                operationId,
                leaseToken);
        return updated > 0;
    }

    private String toJson(Object value) {
        try {
            return objectMapper.writeValueAsString(value);
        } catch (JsonProcessingException exc) {
            throw new IllegalStateException("failed to serialize payload", exc);
        }
    }
}
