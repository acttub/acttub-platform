package com.acttub.actingapi.feature.reading.adapter.db;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.reading.schema.ReadingRecordingRetranscriptEntity;
import jakarta.persistence.LockModeType;
import jakarta.persistence.QueryHint;
import org.springframework.data.domain.Limit;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.jpa.repository.QueryHints;
import org.springframework.data.repository.Repository;

/**
 * {@code reading_recording_retranscripts} 를 읽고 쓰는 문장(apps/api/CONTRACT.md §5-9). 닫는 문장은 모두 임대를 쥐고 있을 때만
 * 고치는 조건부 UPDATE 한 문장이다.
 */
interface ReadingRecordingRetranscriptJpaRepository extends Repository<ReadingRecordingRetranscriptEntity, UUID> {

    /** 집을 행. */
    interface Claimable {
        UUID getRecordingId();

        String getObjectKey();

        int getAttemptCount();
    }

    /** 같은 녹음이 이미 있으면 새 객체 키로 처음부터 다시 줄 세운다. 만든 시각과 모델을 부른 시각은 그대로 둔다. */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            insert into ReadingRecordingRetranscriptEntity (recordingId, objectKey, status, createdAt, updatedAt)
            values (:recordingId, :objectKey, 'queued', :now, :now)
            on conflict (recordingId) do update
            set objectKey = excluded.objectKey, status = 'queued', attemptCount = 0, leaseToken = null, leaseUntil = null,
                peakDb = null, transcript = null, failure = null, updatedAt = excluded.updatedAt
            """)
    int enqueue(UUID recordingId, String objectKey, Instant now);

    /** 임대가 끝났고 시도를 다 쓴 running 을 닫는다. */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            update ReadingRecordingRetranscriptEntity q
            set q.status = 'failed', q.failure = 'lease_expired', q.leaseToken = null, q.leaseUntil = null, q.updatedAt = :now
            where q.status = 'running' and q.leaseUntil < :now and q.attemptCount >= :maxAttempts
            """)
    int closeExhausted(Instant now, int maxAttempts);

    /** 기다리는 것(또는 임대가 끝난 running)을 먼저 줄 세운 것부터 잠가 읽는다. 다른 워커가 잡은 행은 건너뛴다(SKIP LOCKED). */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @QueryHints(@QueryHint(name = "jakarta.persistence.lock.timeout", value = "-2"))
    @Query("""
            select q.recordingId as recordingId, q.objectKey as objectKey, q.attemptCount as attemptCount
            from ReadingRecordingRetranscriptEntity q
            where (q.status = 'queued' or (q.status = 'running' and q.leaseUntil < :now)) and q.attemptCount < :maxAttempts
            order by q.createdAt
            """)
    List<Claimable> lockNext(Instant now, int maxAttempts, Limit limit);

    /** {@link #lockNext} 로 잠근 행에 임대를 적고 시도 수를 하나 올린다. */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            update ReadingRecordingRetranscriptEntity q
            set q.status = 'running', q.leaseToken = :token, q.leaseUntil = :until, q.attemptCount = q.attemptCount + 1,
                q.updatedAt = :now
            where q.recordingId = :recordingId
            """)
    int lease(UUID recordingId, UUID token, Instant until, Instant now);

    @Query("select count(*) from ReadingRecordingRetranscriptEntity q where q.transcribedAt >= :since")
    long transcribedSince(Instant since);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            update ReadingRecordingRetranscriptEntity q
            set q.transcribedAt = :now, q.updatedAt = :now
            where q.recordingId = :recordingId and q.leaseToken = :token and q.status = 'running'
            """)
    int markTranscribing(UUID recordingId, UUID token, Instant now);

    /** @param transcript 받아쓴 글. 채우지 않고 끝낼 때는 그대로 두려고 {@link #finish} 를 쓴다 */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            update ReadingRecordingRetranscriptEntity q
            set q.status = :status, q.transcript = :transcript, q.peakDb = :peakDb, q.failure = null, q.leaseToken = null,
                q.leaseUntil = null, q.updatedAt = :now
            where q.recordingId = :recordingId and q.leaseToken = :token and q.status = 'running'
            """)
    int close(UUID recordingId, UUID token, String status, String transcript, Double peakDb, Instant now);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            update ReadingRecordingRetranscriptEntity q
            set q.status = :status, q.peakDb = :peakDb, q.failure = null, q.leaseToken = null, q.leaseUntil = null,
                q.updatedAt = :now
            where q.recordingId = :recordingId and q.leaseToken = :token and q.status = 'running'
            """)
    int finish(UUID recordingId, UUID token, String status, Double peakDb, Instant now);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            update ReadingRecordingRetranscriptEntity q
            set q.status = :status, q.failure = :failure, q.leaseToken = null, q.leaseUntil = null, q.updatedAt = :now
            where q.recordingId = :recordingId and q.leaseToken = :token and q.status = 'running'
            """)
    int fail(UUID recordingId, UUID token, String status, String failure, Instant now);

    /** 미뤘다 — 다시 줄 세우고 시도 수를 하나 되돌린다(0 아래로 가지 않는다). */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            update ReadingRecordingRetranscriptEntity q
            set q.status = 'queued', q.attemptCount = greatest(q.attemptCount - 1, 0), q.leaseToken = null, q.leaseUntil = null,
                q.updatedAt = :now
            where q.recordingId = :recordingId and q.leaseToken = :token and q.status = 'running'
            """)
    int release(UUID recordingId, UUID token, Instant now);
}
