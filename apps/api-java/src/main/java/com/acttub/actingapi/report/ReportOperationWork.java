package com.acttub.actingapi.report;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/** {@code complete_practice_report_operation}의 트랜잭션 내부 작업. */
@Component
public class ReportOperationWork {

    private final JdbcTemplate jdbc;

    public ReportOperationWork(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /** 호출자가 연 트랜잭션에 참여한다. 내부 헬퍼에는 트랜잭션 경계를 두지 않는다. */
    public boolean execute(
            UUID operationId,
            UUID leaseToken,
            UUID practiceSessionId,
            String reportType,
            JsonNode reportJson,
            UUID sourceHandoffId,
            JsonNode responsePayload,
            OffsetDateTime now) {
        List<UUID> inserted = jdbc.query("""
                INSERT INTO practice_reports (
                    id,
                    practice_session_id,
                    report_type,
                    report_json,
                    source_handoff_id,
                    created_at
                )
                VALUES (?, ?, ?, ?::jsonb, ?, ?)
                ON CONFLICT (source_handoff_id) DO NOTHING
                RETURNING id
                """,
                (row, rowNumber) -> row.getObject("id", UUID.class),
                UUID.randomUUID(),
                practiceSessionId,
                reportType,
                reportJson.toString(),
                sourceHandoffId,
                now);
        if (inserted.isEmpty()) {
            return false;
        }

        int finished = jdbc.update("""
                UPDATE external_operations
                SET status = 'succeeded'::operation_status_t,
                    response_payload = ?::jsonb,
                    error_code = NULL,
                    lease_token = NULL,
                    lease_expires_at = NULL,
                    updated_at = ?
                WHERE id = ?
                  AND status = 'running'::operation_status_t
                  AND lease_token = ?
                """,
                responsePayload.toString(),
                now,
                operationId,
                leaseToken);
        if (finished == 0) {
            throw new LeaseOwnershipException("external operation lease is not owned");
        }
        return true;
    }
}
