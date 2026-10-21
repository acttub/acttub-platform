package com.acttub.actingapi.feature.reading.adapter.db;

import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.reading.app.PronunciationReportRepository;
import com.acttub.actingapi.feature.reading.domain.PronunciationRules.Report;
import com.acttub.actingapi.platform.persistence.NativeTuples;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Tuple;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

@Repository
class PostgresPronunciationReportRepository implements PronunciationReportRepository {
    private final EntityManager entityManager;
    private final TransactionTemplate transaction;
    private final ObjectMapper mapper;

    PostgresPronunciationReportRepository(EntityManager entityManager, PlatformTransactionManager transactionManager,
            ObjectMapper mapper) {
        this.entityManager = entityManager;
        this.transaction = new TransactionTemplate(transactionManager);
        this.mapper = mapper;
    }

    @Override
    public ReportState findOrEnqueue(UUID userId, UUID sessionId, Instant now) {
        return transaction.execute(status -> {
            List<Tuple> session = NativeTuples.list(entityManager.createNativeQuery(
                    "SELECT status FROM reading_sessions WHERE id=:sessionId AND user_id=:userId", Tuple.class)
                    .setParameter("sessionId", sessionId)
                    .setParameter("userId", userId));
            if (session.isEmpty()) {
                return null;
            }
            if (!"completed".equals(session.get(0).get("status", String.class))) {
                return new ReportState("not_ready", null);
            }
            entityManager.createNativeQuery("""
                    INSERT INTO reading_pronunciation_reports(reading_session_id,user_id,status,created_at,updated_at)
                    VALUES (:sessionId,:userId,'queued',CAST(:now AS timestamptz),CAST(:now AS timestamptz))
                    ON CONFLICT (reading_session_id) DO NOTHING
                    """)
                    .setParameter("sessionId", sessionId)
                    .setParameter("userId", userId)
                    .setParameter("now", now.atOffset(ZoneOffset.UTC))
                    .executeUpdate();
            Tuple row = NativeTuples.list(entityManager.createNativeQuery(
                    "SELECT status, CAST(result AS text) AS result FROM reading_pronunciation_reports WHERE reading_session_id=:sessionId",
                    Tuple.class).setParameter("sessionId", sessionId)).get(0);
            return new ReportState(row.get("status", String.class), row.get("result", String.class));
        });
    }

    @Override
    public Claimed claimNext(UUID leaseToken, Duration lease, int maxAttempts, Instant now) {
        return transaction.execute(status -> {
            entityManager.createNativeQuery("""
                    UPDATE reading_pronunciation_reports
                    SET status='failed', failure='lease_expired', lease_token=NULL, lease_until=NULL, updated_at=CAST(:now AS timestamptz)
                    WHERE status='running' AND lease_until < CAST(:now AS timestamptz) AND attempt_count >= :maxAttempts
                    """)
                    .setParameter("now", now.atOffset(ZoneOffset.UTC))
                    .setParameter("maxAttempts", maxAttempts)
                    .executeUpdate();
            List<Tuple> rows = NativeTuples.list(entityManager.createNativeQuery("""
                    UPDATE reading_pronunciation_reports
                    SET status='running', lease_token=:token, lease_until=CAST(:until AS timestamptz),
                        attempt_count=attempt_count+1, updated_at=CAST(:now AS timestamptz)
                    WHERE id = (
                        SELECT id FROM reading_pronunciation_reports
                        WHERE (status='queued' OR (status='running' AND lease_until < CAST(:now AS timestamptz)))
                          AND attempt_count < :maxAttempts
                        ORDER BY created_at
                        LIMIT 1
                        FOR UPDATE SKIP LOCKED)
                    RETURNING id, reading_session_id, attempt_count
                    """, Tuple.class)
                    .setParameter("token", leaseToken)
                    .setParameter("until", now.plus(lease).atOffset(ZoneOffset.UTC))
                    .setParameter("now", now.atOffset(ZoneOffset.UTC))
                    .setParameter("maxAttempts", maxAttempts));
            if (rows.isEmpty()) {
                return null;
            }
            Tuple row = rows.get(0);
            return new Claimed(row.get("id", UUID.class), row.get("reading_session_id", UUID.class),
                    row.get("attempt_count", Integer.class));
        });
    }

    @Override
    public List<LineSource> lines(UUID sessionId) {
        return transaction.execute(status -> NativeTuples.list(entityManager.createNativeQuery("""
                SELECT l.ordinal AS line_no,
                       COALESCE(regexp_replace(l.speech,'⟦[a-z][a-z]⟧',' ','g'),l.text) AS text,
                       r.transcript, r.object_key, r.content_type
                FROM reading_recordings r
                JOIN script_lines l ON l.id=r.line_id
                WHERE r.reading_session_id=:sessionId
                ORDER BY l.ordinal
                """, Tuple.class).setParameter("sessionId", sessionId)).stream()
                .map(row -> new LineSource(row.get("line_no", Integer.class), row.get("text", String.class),
                        row.get("transcript", String.class), row.get("object_key", String.class),
                        row.get("content_type", String.class)))
                .toList());
    }

    @Override
    public boolean complete(UUID reportId, UUID leaseToken, String status, String modelVersion, Report report, Instant now) {
        String json;
        try {
            json = mapper.writeValueAsString(report);
        } catch (JsonProcessingException failure) {
            throw new IllegalStateException(failure);
        }
        Integer updated = transaction.execute(tx -> entityManager.createNativeQuery("""
                UPDATE reading_pronunciation_reports
                SET status=:status, model_version=:model, result=CAST(:result AS jsonb), failure=NULL,
                    lease_token=NULL, lease_until=NULL, updated_at=CAST(:now AS timestamptz)
                WHERE id=:id AND lease_token=:token AND status='running'
                """)
                .setParameter("status", status)
                .setParameter("model", modelVersion)
                .setParameter("result", json)
                .setParameter("now", now.atOffset(ZoneOffset.UTC))
                .setParameter("id", reportId)
                .setParameter("token", leaseToken)
                .executeUpdate());
        return updated != null && updated == 1;
    }

    @Override
    public boolean fail(UUID reportId, UUID leaseToken, String failure, boolean retry, Instant now) {
        Integer updated = transaction.execute(tx -> entityManager.createNativeQuery("""
                UPDATE reading_pronunciation_reports
                SET status=:status, failure=:failure, lease_token=NULL, lease_until=NULL, updated_at=CAST(:now AS timestamptz)
                WHERE id=:id AND lease_token=:token AND status='running'
                """)
                .setParameter("status", retry ? "queued" : "failed")
                .setParameter("failure", failure)
                .setParameter("now", now.atOffset(ZoneOffset.UTC))
                .setParameter("id", reportId)
                .setParameter("token", leaseToken)
                .executeUpdate());
        return updated != null && updated == 1;
    }
}
