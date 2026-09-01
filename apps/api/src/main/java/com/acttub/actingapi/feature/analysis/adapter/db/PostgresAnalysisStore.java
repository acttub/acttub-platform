package com.acttub.actingapi.feature.analysis.adapter.db;

import static com.acttub.actingapi.platform.schema.NativeTuples.list;

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
import com.acttub.actingapi.feature.analysis.schema.TranscriptEntity;
import com.acttub.actingapi.platform.ledger.LeaseOwnershipException;
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
    private final ObjectMapper mapper;
    private final AnalysisOperationQueue queue;
    private final TransactionTemplate transaction;

    public PostgresAnalysisStore(
            EntityManager entityManager,
            ObjectMapper mapper,
            AnalysisOperationQueue queue,
            PlatformTransactionManager transactionManager) {
        this.entityManager = entityManager;
        this.mapper = mapper;
        this.queue = queue;
        this.transaction = new TransactionTemplate(transactionManager);
        this.transaction.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
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
                    ps.blockage_detail
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
                row.get("blockage_detail", String.class));
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
        UUID summaryId = UUID.randomUUID();
        JsonNode observations = mapper.valueToTree(result.observationPack().observations());
        JsonNode uncertainties = mapper.valueToTree(result.observationPack().uncertainties());
        JsonNode raw = mapper.valueToTree(result.observationPack());
        entityManager.persist(new SummaryEntity(
                summaryId,
                sessionId,
                model,
                result.wasCompressed(),
                raw,
                observations,
                uncertainties));
        for (int index = 0; index < result.transcripts().size(); index++) {
            entityManager.persist(new TranscriptEntity(
                    UUID.randomUUID(), sessionId, index, result.transcripts().get(index)));
        }
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
                .setParameter("responsePayload", response.toString())
                .setParameter("now", now)
                .setParameter("operationId", operationId)
                .setParameter("leaseToken", leaseToken)
                .executeUpdate();
        if (finished == 0) {
            throw new LeaseOwnershipException("external operation lease is not owned");
        }
        return summaryId;
    }
}
