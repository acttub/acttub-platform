package com.acttub.actingapi.feature.analysis.adapter.db;

import static com.acttub.actingapi.platform.persistence.NativeTuples.list;

import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.analysis.app.AnalysisContext;
import com.acttub.actingapi.feature.analysis.app.AnalysisOperationQueue;
import com.acttub.actingapi.feature.analysis.app.AnalysisResult;
import com.acttub.actingapi.feature.analysis.app.AnalysisStore;
import com.acttub.actingapi.feature.analysis.schema.SummaryEntity;
import com.acttub.actingapi.platform.ledger.LeaseOwnershipException;
import com.acttub.actingapi.platform.ledger.ExternalOperationMonitoring;
import com.acttub.actingapi.platform.ledger.ExternalOperationExecution;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Tuple;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

/** 분석 저장 전이. 각 public 변경 메서드는 외부 호출과 분리된 새 트랜잭션이다. */
@Repository
public class PostgresAnalysisStore implements AnalysisStore {
    private final EntityManager entityManager;
    private final ExternalOperationMonitoring monitoring;
    private final ObjectMapper mapper;
    private final AnalysisOperationQueue queue;
    private final TransactionTemplate transaction;

    public PostgresAnalysisStore(
            EntityManager entityManager,
            ObjectMapper mapper,
            AnalysisOperationQueue queue,
            PlatformTransactionManager transactionManager, ExternalOperationMonitoring monitoring) {
        this.entityManager = entityManager;
        this.monitoring = monitoring;
        this.mapper = mapper;
        this.queue = queue;
        this.transaction = new TransactionTemplate(transactionManager);
        this.transaction.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    }

    @Override
    public ExternalOperationExecution execution(UUID operationId, UUID leaseToken) {
        return queue.execution(operationId, leaseToken);
    }

    @Override
    public UUID claimNext(UUID leaseToken, Duration leaseDuration, Instant now) {
        return queue.claimNext(leaseToken, leaseDuration, now);
    }

    @Override
    public AnalysisContext getContext(UUID operationId) {
        List<Tuple> rows = list(entityManager.createNativeQuery("""
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
                    ps.blockage_detail,
                    ps.experience_version,
                    ps.user_id
                FROM external_operations eo
                JOIN practice_sessions ps ON ps.id = eo.session_id
                JOIN upload_intents ui ON ui.id = ps.upload_intent_id
                WHERE eo.id = :operationId
                  AND eo.kind = 'analyze'
                """, Tuple.class)
                .setParameter("operationId", operationId));
        if (rows.isEmpty()) {
            return null;
        }
        Tuple row = rows.getFirst();
        return new AnalysisContext(
                row.get("operation_id", UUID.class),
                row.get("session_id", UUID.class),
                row.get("object_key", String.class),
                row.get("mime_type", String.class),
                row.get("etag", String.class),
                row.get("duration_ms", Integer.class),
                row.get("situation", String.class),
                row.get("character_context", String.class),
                row.get("goal", String.class),
                row.get("blockage_kind", String.class),
                row.get("blockage_detail", String.class),
                row.get("experience_version", String.class),
                row.get("user_id", UUID.class));
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
        return queue.fail(operationId, leaseToken, errorCode, now);
    }

    @Override
    public void release(UUID operationId, UUID leaseToken, Instant now) {
        queue.release(operationId, leaseToken, now);
    }

    @Override
    public boolean fail(UUID operationId, UUID leaseToken, String errorCode, String classification, Instant now) {
        return queue.fail(operationId, leaseToken, errorCode, classification, now);
    }

    @Override
    public void release(UUID operationId, UUID leaseToken, String classification, Instant now) {
        queue.release(operationId, leaseToken, classification, now);
    }

    @Override
    public List<String> sweepExpiredUploads(Instant now) {
        OffsetDateTime expiredAt = now.atOffset(ZoneOffset.UTC);
        List<String> result = transaction.execute(status ->
                list(entityManager.createNativeQuery("""
                        WITH expired AS (
                            UPDATE upload_intents
                            SET status = 'expired'
                            WHERE status = 'pending'
                              AND expires_at < :expiredAt
                            RETURNING object_key
                        )
                        SELECT object_key FROM expired
                        """, Tuple.class)
                        .setParameter("expiredAt", expiredAt)).stream()
                        .map(row -> row.get("object_key", String.class))
                        .toList());
        return result == null ? List.of() : result;
    }

    @Override
    public int sweepMaxAttempts(Instant now) {
        return queue.sweepMaxAttempts(now);
    }

    private UUID completeInTransaction(
            UUID operationId,
            UUID leaseToken,
            AnalysisResult result,
            String model,
            OffsetDateTime now) {
        List<Tuple> operations = list(entityManager.createNativeQuery("""
                SELECT session_id AS session_id
                FROM external_operations
                WHERE id = :operationId
                  AND kind = 'analyze'
                """, Tuple.class)
                .setParameter("operationId", operationId));
        if (operations.isEmpty()) {
            throw new IllegalStateException("external operation not found");
        }
        UUID sessionId = operations.getFirst().get("session_id", UUID.class);
        // 공유 업로드의 유효한 길이는 유지하고, 측정값은 완료 전이와 함께 원자적으로 채운다.
        // upload_intents 잠금을 practice_sessions·external_operations 갱신보다 먼저 얻는다.
        entityManager.createNativeQuery("""
                UPDATE upload_intents
                SET duration_ms = :durationMs
                WHERE id = (SELECT upload_intent_id FROM practice_sessions WHERE id = :sessionId)
                  AND duration_ms IS NULL
                """)
                .setParameter("durationMs", result.durationMs())
                .setParameter("sessionId", sessionId)
                .executeUpdate();
        boolean fullRecord = result.videoRecord() != null;
        UUID summaryId = fullRecord ? UUID.fromString(result.videoRecord().path("record_id").asText()) : UUID.randomUUID();
        JsonNode observations = fullRecord ? mapper.createArrayNode() : mapper.valueToTree(result.observationPack().observations());
        JsonNode uncertainties = fullRecord ? mapper.createArrayNode() : mapper.valueToTree(result.observationPack().uncertainties());
        JsonNode raw = fullRecord ? result.videoRecord() : mapper.valueToTree(result.observationPack());
        entityManager.persist(new SummaryEntity(
                summaryId,
                sessionId,
                model,
                result.wasCompressed(),
                raw,
                observations,
                uncertainties));
        // Hibernate write-behind가 뒤의 상태 전이보다 INSERT를 늦추지 않게 순서를 고정한다.
        entityManager.flush();

        entityManager.createNativeQuery("""
                UPDATE practice_sessions
                SET status = 'analyzed',
                    updated_at = :now
                WHERE id = :sessionId
                """)
                .setParameter("now", now)
                .setParameter("sessionId", sessionId)
                .executeUpdate();
        entityManager.createNativeQuery("""
                UPDATE coach_sessions
                SET summary_id = :summaryId, updated_at = :now
                WHERE practice_session_id = :sessionId
                  AND summary_id IS NULL
                """)
                .setParameter("summaryId", summaryId)
                .setParameter("now", now)
                .setParameter("sessionId", sessionId)
                .executeUpdate();

        ObjectNode response = mapper.createObjectNode();
        response.put("session_id", sessionId.toString());
        response.put("status", "analyzed");
        response.put("summary_id", summaryId.toString());
        List<Tuple> finished = list(entityManager.createNativeQuery("""
                WITH finished AS (
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
                    RETURNING kind, created_at
                )
                SELECT kind, created_at FROM finished
                """, Tuple.class)
                .setParameter("responsePayload", response.toString())
                .setParameter("now", now)
                .setParameter("operationId", operationId)
                .setParameter("leaseToken", leaseToken));
        if (finished.isEmpty()) {
            throw new LeaseOwnershipException("external operation lease is not owned");
        }
        monitoring.terminal(new ExternalOperationMonitoring.Terminal(operationId,
                finished.getFirst().get("kind", String.class), "succeeded", null,
                finished.getFirst().get("created_at", Instant.class)));
        return summaryId;
    }
}
