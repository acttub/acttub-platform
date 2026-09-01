package com.acttub.actingapi.feature.report.adapter.db;

import static com.acttub.actingapi.platform.schema.NativeTuples.list;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.platform.ledger.LeaseOwnershipException;
import com.fasterxml.jackson.databind.JsonNode;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Tuple;
import org.springframework.stereotype.Component;

/** {@code complete_practice_report_operation}의 트랜잭션 내부 작업. */
@Component
public class ReportOperationWork {

    private final EntityManager entityManager;

    public ReportOperationWork(EntityManager entityManager) {
        this.entityManager = entityManager;
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
        List<Tuple> inserted = list(entityManager.createNativeQuery("""
                WITH inserted AS (
                    INSERT INTO practice_reports (
                        id,
                        practice_session_id,
                        report_type,
                        report_json,
                        source_handoff_id,
                        created_at
                    )
                    VALUES (
                        :id,
                        :practiceSessionId,
                        :reportType,
                        CAST(:reportJson AS jsonb),
                        :sourceHandoffId,
                        :now
                    )
                    ON CONFLICT (source_handoff_id) DO NOTHING
                    RETURNING id
                )
                SELECT id FROM inserted
                """, Tuple.class)
                .setParameter("id", UUID.randomUUID())
                .setParameter("practiceSessionId", practiceSessionId)
                .setParameter("reportType", reportType)
                .setParameter("reportJson", reportJson.toString())
                .setParameter("sourceHandoffId", sourceHandoffId)
                .setParameter("now", now));
        if (inserted.isEmpty()) {
            return false;
        }

        int finished = entityManager.createNativeQuery("""
                UPDATE external_operations
                SET status = 'succeeded',
                    response_payload = CAST(:responsePayload AS jsonb),
                    error_code = NULL,
                    lease_token = NULL,
                    lease_expires_at = NULL,
                    updated_at = :now
                WHERE id = :operationId
                  AND status = 'running'
                  AND lease_token = :leaseToken
                """)
                .setParameter("responsePayload", responsePayload.toString())
                .setParameter("now", now)
                .setParameter("operationId", operationId)
                .setParameter("leaseToken", leaseToken)
                .executeUpdate();
        if (finished == 0) {
            throw new LeaseOwnershipException("external operation lease is not owned");
        }
        return true;
    }
}
