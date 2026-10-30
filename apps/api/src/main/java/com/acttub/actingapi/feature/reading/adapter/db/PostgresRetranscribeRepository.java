package com.acttub.actingapi.feature.reading.adapter.db;

import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.reading.app.RetranscribeRepository;
import com.acttub.actingapi.feature.reading.domain.RecordingRules;
import com.acttub.actingapi.platform.persistence.NativeTuples;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Tuple;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/** 리딩 녹음 서버 다시 받아쓰기 큐(V78). 표는 이 저장소의 native SQL 만 읽고 쓴다. */
@Repository
class PostgresRetranscribeRepository implements RetranscribeRepository {
    private final EntityManager entityManager;
    private final TransactionTemplate transaction;

    PostgresRetranscribeRepository(EntityManager entityManager, PlatformTransactionManager transactionManager) {
        this.entityManager = entityManager;
        this.transaction = new TransactionTemplate(transactionManager);
    }

    @Override
    public void enqueue(UUID recordingId, String objectKey, Instant now) {
        transaction.executeWithoutResult(status -> entityManager.createNativeQuery("""
                INSERT INTO reading_recording_retranscripts(recording_id,object_key,status,created_at,updated_at)
                VALUES (:id,:key,'queued',CAST(:now AS timestamptz),CAST(:now AS timestamptz))
                ON CONFLICT (recording_id) DO UPDATE
                SET object_key=EXCLUDED.object_key, status='queued', attempt_count=0, lease_token=NULL, lease_until=NULL,
                    peak_db=NULL, transcript=NULL, failure=NULL, updated_at=EXCLUDED.updated_at
                """)
                .setParameter("id", recordingId)
                .setParameter("key", objectKey)
                .setParameter("now", utc(now))
                .executeUpdate());
    }

    @Override
    public Claimed claimNext(UUID leaseToken, Duration lease, int maxAttempts, Instant now) {
        return transaction.execute(status -> {
            entityManager.createNativeQuery("""
                    UPDATE reading_recording_retranscripts
                    SET status='failed', failure='lease_expired', lease_token=NULL, lease_until=NULL,
                        updated_at=CAST(:now AS timestamptz)
                    WHERE status='running' AND lease_until < CAST(:now AS timestamptz) AND attempt_count >= :maxAttempts
                    """)
                    .setParameter("now", utc(now))
                    .setParameter("maxAttempts", maxAttempts)
                    .executeUpdate();
            List<Tuple> rows = NativeTuples.list(entityManager.createNativeQuery("""
                    UPDATE reading_recording_retranscripts q
                    SET status='running', lease_token=:token, lease_until=CAST(:until AS timestamptz),
                        attempt_count=q.attempt_count+1, updated_at=CAST(:now AS timestamptz)
                    WHERE q.recording_id = (
                        SELECT recording_id FROM reading_recording_retranscripts
                        WHERE (status='queued' OR (status='running' AND lease_until < CAST(:now AS timestamptz)))
                          AND attempt_count < :maxAttempts
                        ORDER BY created_at
                        LIMIT 1
                        FOR UPDATE SKIP LOCKED)
                    RETURNING q.recording_id, q.object_key, q.attempt_count
                    """, Tuple.class)
                    .setParameter("token", leaseToken)
                    .setParameter("until", utc(now.plus(lease)))
                    .setParameter("now", utc(now))
                    .setParameter("maxAttempts", maxAttempts));
            if (rows.isEmpty()) {
                return null;
            }
            Tuple row = rows.get(0);
            UUID recordingId = row.get("recording_id", UUID.class);
            String objectKey = row.get("object_key", String.class);
            List<Tuple> recording = NativeTuples.list(entityManager.createNativeQuery("""
                    SELECT duration_ms,
                           (object_key=:key AND transcript_source='stt' AND (transcript IS NULL OR btrim(transcript)=''))
                               AS current
                    FROM reading_recordings WHERE id=:id
                    """, Tuple.class)
                    .setParameter("id", recordingId)
                    .setParameter("key", objectKey));
            Integer durationMs = recording.isEmpty() ? null : recording.get(0).get("duration_ms", Integer.class);
            boolean current = !recording.isEmpty() && Boolean.TRUE.equals(recording.get(0).get("current", Boolean.class));
            return new Claimed(recordingId, objectKey, durationMs, row.get("attempt_count", Integer.class), current);
        });
    }

    @Override
    public long transcribedSince(Instant since) {
        Number count = transaction.execute(status -> (Number) entityManager.createNativeQuery(
                "SELECT count(*) FROM reading_recording_retranscripts WHERE transcribed_at >= CAST(:since AS timestamptz)")
                .setParameter("since", utc(since))
                .getSingleResult());
        return count == null ? 0 : count.longValue();
    }

    @Override
    public void markTranscribing(UUID recordingId, UUID leaseToken, Instant now) {
        transaction.executeWithoutResult(status -> entityManager.createNativeQuery("""
                UPDATE reading_recording_retranscripts
                SET transcribed_at=CAST(:now AS timestamptz), updated_at=CAST(:now AS timestamptz)
                WHERE recording_id=:id AND lease_token=:token AND status='running'
                """)
                .setParameter("now", utc(now))
                .setParameter("id", recordingId)
                .setParameter("token", leaseToken)
                .executeUpdate());
    }

    @Override
    public boolean fill(UUID recordingId, UUID leaseToken, String objectKey, String transcript, Double peakDb, Instant now) {
        Boolean filled = transaction.execute(status -> {
            String line = lineText(recordingId);
            Boolean matched = line == null ? null : RecordingRules.matched(transcript, line);
            int updated = entityManager.createNativeQuery("""
                    UPDATE reading_recordings
                    SET transcript=:transcript, matched=CAST(:matched AS boolean), updated_at=CAST(:now AS timestamptz)
                    WHERE id=:id AND object_key=:key AND transcript_source='stt'
                      AND (transcript IS NULL OR btrim(transcript)='')
                    """)
                    .setParameter("transcript", transcript)
                    .setParameter("matched", matched)
                    .setParameter("now", utc(now))
                    .setParameter("id", recordingId)
                    .setParameter("key", objectKey)
                    .executeUpdate();
            entityManager.createNativeQuery("""
                    UPDATE reading_recording_retranscripts
                    SET status=:status, transcript=:transcript, peak_db=CAST(:peak AS double precision), failure=NULL, lease_token=NULL,
                        lease_until=NULL, updated_at=CAST(:now AS timestamptz)
                    WHERE recording_id=:id AND lease_token=:token AND status='running'
                    """)
                    .setParameter("status", updated == 1 ? "done" : "stale")
                    .setParameter("transcript", transcript)
                    .setParameter("peak", peakDb)
                    .setParameter("now", utc(now))
                    .setParameter("id", recordingId)
                    .setParameter("token", leaseToken)
                    .executeUpdate();
            return updated == 1;
        });
        return Boolean.TRUE.equals(filled);
    }

    @Override
    public void finish(UUID recordingId, UUID leaseToken, String status, Double peakDb, Instant now) {
        transaction.executeWithoutResult(tx -> entityManager.createNativeQuery("""
                UPDATE reading_recording_retranscripts
                SET status=:status, peak_db=CAST(:peak AS double precision), failure=NULL, lease_token=NULL, lease_until=NULL,
                    updated_at=CAST(:now AS timestamptz)
                WHERE recording_id=:id AND lease_token=:token AND status='running'
                """)
                .setParameter("status", status)
                .setParameter("peak", peakDb)
                .setParameter("now", utc(now))
                .setParameter("id", recordingId)
                .setParameter("token", leaseToken)
                .executeUpdate());
    }

    @Override
    public void fail(UUID recordingId, UUID leaseToken, String failure, boolean retry, Instant now) {
        transaction.executeWithoutResult(tx -> entityManager.createNativeQuery("""
                UPDATE reading_recording_retranscripts
                SET status=:status, failure=:failure, lease_token=NULL, lease_until=NULL, updated_at=CAST(:now AS timestamptz)
                WHERE recording_id=:id AND lease_token=:token AND status='running'
                """)
                .setParameter("status", retry ? "queued" : "failed")
                .setParameter("failure", failure)
                .setParameter("now", utc(now))
                .setParameter("id", recordingId)
                .setParameter("token", leaseToken)
                .executeUpdate());
    }

    @Override
    public void release(UUID recordingId, UUID leaseToken, Instant now) {
        transaction.executeWithoutResult(tx -> entityManager.createNativeQuery("""
                UPDATE reading_recording_retranscripts
                SET status='queued', attempt_count=GREATEST(attempt_count-1,0), lease_token=NULL, lease_until=NULL,
                    updated_at=CAST(:now AS timestamptz)
                WHERE recording_id=:id AND lease_token=:token AND status='running'
                """)
                .setParameter("now", utc(now))
                .setParameter("id", recordingId)
                .setParameter("token", leaseToken)
                .executeUpdate());
    }

    /** 녹음을 저장할 때 대조한 원문과 같은 글 — 회차 연습 구간 안의 내 대사 줄이 아니면 {@code null}. */
    private String lineText(UUID recordingId) {
        List<Tuple> rows = NativeTuples.list(entityManager.createNativeQuery("""
                SELECT COALESCE(regexp_replace(l.speech,'⟦[a-z][a-z]⟧',' ','g'),l.text) AS text
                FROM reading_recordings r
                JOIN reading_sessions rs ON rs.id=r.reading_session_id
                JOIN script_lines s ON s.id=rs.start_line_id
                JOIN script_lines e ON e.id=rs.end_line_id
                JOIN script_lines l ON l.id=r.line_id AND l.script_id=rs.script_id
                WHERE r.id=:id
                  AND l.kind='dialogue'
                  AND l.ordinal BETWEEN s.ordinal AND e.ordinal
                  AND (l.character_id=ANY(rs.my_character_ids)
                       OR EXISTS (SELECT 1 FROM script_characters lc
                                  WHERE lc.id=l.character_id AND lc.member_ids && rs.my_character_ids))
                """, Tuple.class).setParameter("id", recordingId));
        return rows.isEmpty() ? null : rows.get(0).get("text", String.class);
    }

    private static OffsetDateTime utc(Instant instant) {
        return instant.atOffset(ZoneOffset.UTC);
    }
}
