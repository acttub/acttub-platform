package com.acttub.actingapi.analysis;

import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.operation.ExternalOperationClaimer;
import com.acttub.actingapi.report.LeaseOwnershipException;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

/** 분석 저장 전이. 각 public 변경 메서드는 외부 호출과 분리된 새 트랜잭션이다. */
@Repository
public class PostgresAnalysisStore implements AnalysisStore {
    private static final String ANALYZE = "analyze";

    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;
    private final ExternalOperationClaimer claimer;
    private final TransactionTemplate transaction;

    public PostgresAnalysisStore(
            JdbcTemplate jdbc,
            ObjectMapper mapper,
            ExternalOperationClaimer claimer,
            PlatformTransactionManager transactionManager) {
        this.jdbc = jdbc;
        this.mapper = mapper;
        this.claimer = claimer;
        this.transaction = new TransactionTemplate(transactionManager);
        this.transaction.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    }

    @Override
    public UUID claimNext(UUID leaseToken, Duration leaseDuration, Instant now) {
        return claimer.claimNext(ANALYZE, leaseToken, leaseDuration, now);
    }

    @Override
    public AnalysisContext getContext(UUID operationId) {
        List<AnalysisContext> rows = jdbc.query("""
                SELECT
                    eo.id AS operation_id,
                    ps.id AS session_id,
                    ui.object_key,
                    ui.mime_type,
                    ui.etag,
                    ui.duration_ms,
                    ps.situation,
                    ps.character_context,
                    ps.goal,
                    ps.blockage_kind,
                    ps.blockage_detail
                FROM external_operations eo
                JOIN practice_sessions ps ON ps.id = eo.session_id
                JOIN upload_intents ui ON ui.id = ps.upload_intent_id
                WHERE eo.id = ?
                  AND eo.kind = 'analyze'::operation_kind_t
                """,
                (row, number) -> new AnalysisContext(
                        row.getObject("operation_id", UUID.class),
                        row.getObject("session_id", UUID.class),
                        row.getString("object_key"),
                        row.getString("mime_type"),
                        row.getString("etag"),
                        row.getObject("duration_ms", Integer.class),
                        row.getString("situation"),
                        row.getString("character_context"),
                        row.getString("goal"),
                        row.getString("blockage_kind"),
                        row.getString("blockage_detail")),
                operationId);
        return rows.isEmpty() ? null : rows.getFirst();
    }

    @Override
    public UUID complete(
            UUID operationId,
            UUID leaseToken,
            AnalysisResult result,
            String model,
            Instant now) {
        return transaction.execute(status -> completeInTransaction(
                operationId, leaseToken, result, model, now.atOffset(ZoneOffset.UTC)));
    }

    @Override
    public boolean fail(
            UUID operationId,
            UUID leaseToken,
            String errorCode,
            Instant now) {
        return claimer.fail(operationId, leaseToken, errorCode, true, now);
    }

    @Override
    public void release(UUID operationId, UUID leaseToken, Instant now) {
        claimer.release(operationId, leaseToken, now);
    }

    @Override
    public List<String> sweepExpiredUploads(Instant now) {
        OffsetDateTime expiredAt = now.atOffset(ZoneOffset.UTC);
        List<String> result = transaction.execute(status -> jdbc.queryForList("""
                UPDATE upload_intents
                SET status = 'expired'::upload_status_t
                WHERE status = 'pending'::upload_status_t
                  AND expires_at < ?
                RETURNING object_key
                """, String.class, expiredAt));
        return result == null ? List.of() : result;
    }

    @Override
    public int sweepMaxAttempts(Instant now) {
        return claimer.sweepMaxAttempts(now);
    }

    private UUID completeInTransaction(
            UUID operationId,
            UUID leaseToken,
            AnalysisResult result,
            String model,
            OffsetDateTime now) {
        List<UUID> sessionIds = jdbc.queryForList("""
                SELECT session_id
                FROM external_operations
                WHERE id = ?
                  AND kind = 'analyze'::operation_kind_t
                """, UUID.class, operationId);
        if (sessionIds.isEmpty()) {
            throw new IllegalStateException("external operation not found");
        }
        UUID sessionId = sessionIds.getFirst();
        UUID summaryId = UUID.randomUUID();
        String observations = json(result.observationPack().observations());
        String uncertainties = json(result.observationPack().uncertainties());
        String raw = json(result.observationPack());
        jdbc.update("""
                INSERT INTO summaries(
                    id, session_id, model, was_compressed, raw,
                    observations_json, uncertainties_json)
                VALUES (?, ?, ?, ?, ?::jsonb, ?::jsonb, ?::jsonb)
                """,
                summaryId,
                sessionId,
                model,
                result.wasCompressed(),
                raw,
                observations,
                uncertainties);
        for (int index = 0; index < result.transcripts().size(); index++) {
            jdbc.update("""
                    INSERT INTO transcripts(id, session_id, ord, text)
                    VALUES (?, ?, ?, ?)
                    """, UUID.randomUUID(), sessionId, index, result.transcripts().get(index));
        }
        jdbc.update("""
                UPDATE practice_sessions
                SET status = 'analyzed'::practice_status_t,
                    updated_at = ?
                WHERE id = ?
                """, now, sessionId);
        jdbc.update("""
                UPDATE coach_sessions
                SET summary_id = ?, updated_at = ?
                WHERE practice_session_id = ?
                  AND summary_id IS NULL
                """, summaryId, now, sessionId);

        ObjectNode response = mapper.createObjectNode();
        response.put("session_id", sessionId.toString());
        response.put("status", "analyzed");
        response.put("summary_id", summaryId.toString());
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
                """, response.toString(), now, operationId, leaseToken);
        if (finished == 0) {
            throw new LeaseOwnershipException("external operation lease is not owned");
        }
        return summaryId;
    }

    private String json(Object value) {
        try {
            return mapper.writeValueAsString(value);
        } catch (JsonProcessingException exception) {
            throw new IllegalStateException("analysis result is not serializable", exception);
        }
    }
}
