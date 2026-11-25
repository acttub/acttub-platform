package com.acttub.actingapi.feature.reading.adapter.db;

import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.reading.app.RetranscribeRepository;
import com.acttub.actingapi.feature.reading.domain.RecordingRules;
import com.acttub.actingapi.platform.persistence.NativeTuples;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Tuple;
import org.springframework.data.domain.Limit;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 리딩 녹음 서버 다시 받아쓰기 큐(V79)의 Postgres 구현. 큐의 문장은 {@link ReadingRecordingRetranscriptJpaRepository} 에 있다.
 *
 * <p>집기는 잠가 읽기({@code for update … skip locked})와 임대 적기 두 문장이다(apps/api/CONTRACT.md §5-9). 녹음의 주인이
 * 활성인지 보는 두 문장(집은 뒤의 녹음 읽기, 전사 채우기)은 auth 의 {@code users} 를 한 문장 안에서 읽어 native SQL 로 둔다.
 */
@Repository
class PostgresRetranscribeRepository implements RetranscribeRepository {
    private final EntityManager entityManager;
    private final ReadingRecordingRetranscriptJpaRepository queue;
    private final ReadingRecordingJpaRepository recordings;
    private final TransactionTemplate transaction;

    PostgresRetranscribeRepository(EntityManager entityManager, ReadingRecordingRetranscriptJpaRepository queue,
            ReadingRecordingJpaRepository recordings, PlatformTransactionManager transactionManager) {
        this.entityManager = entityManager;
        this.queue = queue;
        this.recordings = recordings;
        this.transaction = new TransactionTemplate(transactionManager);
    }

    @Override
    public void enqueue(UUID recordingId, String objectKey, Instant now) {
        transaction.executeWithoutResult(status -> queue.enqueue(recordingId, objectKey, now));
    }

    @Override
    public Claimed claimNext(UUID leaseToken, Duration lease, int maxAttempts, Instant now) {
        return transaction.execute(status -> {
            queue.closeExhausted(now, maxAttempts);
            List<ReadingRecordingRetranscriptJpaRepository.Claimable> next = queue.lockNext(now, maxAttempts, Limit.of(1));
            if (next.isEmpty()) {
                return null;
            }
            UUID recordingId = next.getFirst().getRecordingId();
            String objectKey = next.getFirst().getObjectKey();
            int attempt = next.getFirst().getAttemptCount() + 1;
            queue.lease(recordingId, leaseToken, now.plus(lease), now);
            // 탈퇴한 계정의 보관 녹음은 모델에 보내지 않는다(common.md 「모델을 기다린 뒤의 저장」) — 지금 녹음이 아닌 것으로 닫는다.
            List<Tuple> recording = NativeTuples.list(entityManager.createNativeQuery("""
                    SELECT r.duration_ms,
                           (r.object_key=:key AND r.transcript_source='stt' AND (r.transcript IS NULL OR btrim(r.transcript)='')
                            AND u.status='active') AS current
                    FROM reading_recordings r JOIN users u ON u.id=r.user_id
                    WHERE r.id=:id
                    """, Tuple.class)
                    .setParameter("id", recordingId)
                    .setParameter("key", objectKey));
            Integer durationMs = recording.isEmpty() ? null : recording.get(0).get("duration_ms", Integer.class);
            boolean current = !recording.isEmpty() && Boolean.TRUE.equals(recording.get(0).get("current", Boolean.class));
            return new Claimed(recordingId, objectKey, durationMs, attempt, current);
        });
    }

    @Override
    public long transcribedSince(Instant since) {
        Long count = transaction.execute(status -> queue.transcribedSince(since));
        return count == null ? 0 : count;
    }

    @Override
    public void markTranscribing(UUID recordingId, UUID leaseToken, Instant now) {
        transaction.executeWithoutResult(status -> queue.markTranscribing(recordingId, leaseToken, now));
    }

    @Override
    public boolean fill(UUID recordingId, UUID leaseToken, String objectKey, String transcript, Double peakDb, Instant now) {
        Boolean filled = transaction.execute(status -> {
            List<String> line = recordings.myLineText(recordingId);
            Boolean matched = line.isEmpty() ? null : RecordingRules.matched(transcript, line.getFirst());
            // 받아쓰는 사이에 탈퇴했으면 채우지 않는다(stale).
            int updated = entityManager.createNativeQuery("""
                    UPDATE reading_recordings r
                    SET transcript=:transcript, matched=CAST(:matched AS boolean), updated_at=CAST(:now AS timestamptz)
                    WHERE r.id=:id AND r.object_key=:key AND r.transcript_source='stt'
                      AND (r.transcript IS NULL OR btrim(r.transcript)='')
                      AND EXISTS (SELECT 1 FROM users u WHERE u.id=r.user_id AND u.status='active')
                    """)
                    .setParameter("transcript", transcript)
                    .setParameter("matched", matched)
                    .setParameter("now", now.atOffset(ZoneOffset.UTC))
                    .setParameter("id", recordingId)
                    .setParameter("key", objectKey)
                    .executeUpdate();
            int leased = queue.close(recordingId, leaseToken, updated == 1 ? "done" : "stale", transcript, peakDb, now);
            if (leased == 0) {
                // 임대를 잃었다 — 녹음을 고친 것까지 되돌린다. 잠그는 순서(녹음 → 큐)는 녹음 삭제의 CASCADE 와 같게 둔다.
                status.setRollbackOnly();
                return false;
            }
            return updated == 1;
        });
        return Boolean.TRUE.equals(filled);
    }

    @Override
    public void finish(UUID recordingId, UUID leaseToken, String status, Double peakDb, Instant now) {
        transaction.executeWithoutResult(tx -> queue.finish(recordingId, leaseToken, status, peakDb, now));
    }

    @Override
    public void fail(UUID recordingId, UUID leaseToken, String failure, boolean retry, Instant now) {
        transaction.executeWithoutResult(tx -> queue.fail(recordingId, leaseToken, retry ? "queued" : "failed", failure, now));
    }

    @Override
    public void release(UUID recordingId, UUID leaseToken, Instant now) {
        transaction.executeWithoutResult(tx -> queue.release(recordingId, leaseToken, now));
    }
}
