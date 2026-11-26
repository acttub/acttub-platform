package com.acttub.actingapi.feature.reading.adapter.db;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import com.acttub.actingapi.feature.reading.schema.ReadingPronunciationReportEntity;
import jakarta.persistence.LockModeType;
import jakarta.persistence.QueryHint;
import org.springframework.data.domain.Limit;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.jpa.repository.QueryHints;
import org.springframework.data.repository.Repository;

/**
 * {@code reading_pronunciation_reports} 를 읽고 쓰는 문장(apps/api/CONTRACT.md §5-9). 완료·실패·임대는 조건부 UPDATE 한
 * 문장이고 영향 행 수가 임대를 쥐고 있었는지를 말한다.
 */
interface ReadingPronunciationReportJpaRepository extends Repository<ReadingPronunciationReportEntity, UUID> {

    /** 상태와 결과(jsonb 를 글로). */
    interface State {
        String getStatus();

        String getResult();
    }

    /** 집을 행. */
    interface Claimable {
        UUID getId();

        UUID getReadingSessionId();

        int getAttemptCount();
    }

    @Query("select r.status as status, r.result as result from ReadingPronunciationReportEntity r where r.readingSessionId = :sessionId")
    Optional<State> state(UUID sessionId);

    /** 회차마다 한 행이다. 이미 있으면 0행이다. */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            insert into ReadingPronunciationReportEntity (id, readingSessionId, userId, status, createdAt, updatedAt)
            values (:id, :sessionId, :userId, 'queued', :now, :now)
            on conflict (readingSessionId) do nothing
            """)
    int enqueue(UUID id, UUID sessionId, UUID userId, Instant now);

    /** 임대가 끝났고 시도를 다 쓴 running 을 닫는다. */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            update ReadingPronunciationReportEntity r
            set r.status = 'failed', r.failure = 'lease_expired', r.leaseToken = null, r.leaseUntil = null, r.updatedAt = :now
            where r.status = 'running' and r.leaseUntil < :now and r.attemptCount >= :maxAttempts
            """)
    int closeExhausted(Instant now, int maxAttempts);

    /**
     * 기다리는 것(또는 임대가 끝난 running)을 먼저 만든 것부터 잠가 읽는다. 다른 워커가 잡은 행은 기다리지 않고 건너뛴다 —
     * 잠금 시한 -2 가 {@code for update of … skip locked} 로 나간다. 잠근 행은 이 트랜잭션이 끝날 때까지 다른 워커가 집지 못한다.
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @QueryHints(@QueryHint(name = "jakarta.persistence.lock.timeout", value = "-2"))
    @Query("""
            select r.id as id, r.readingSessionId as readingSessionId, r.attemptCount as attemptCount
            from ReadingPronunciationReportEntity r
            where (r.status = 'queued' or (r.status = 'running' and r.leaseUntil < :now)) and r.attemptCount < :maxAttempts
            order by r.createdAt
            """)
    List<Claimable> lockNext(Instant now, int maxAttempts, Limit limit);

    /** {@link #lockNext} 로 잠근 행에 임대를 적고 시도 수를 하나 올린다. */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            update ReadingPronunciationReportEntity r
            set r.status = 'running', r.leaseToken = :token, r.leaseUntil = :until, r.attemptCount = r.attemptCount + 1,
                r.updatedAt = :now
            where r.id = :id
            """)
    int lease(UUID id, UUID token, Instant until, Instant now);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            update ReadingPronunciationReportEntity r
            set r.status = :status, r.modelVersion = :model, r.result = :result, r.failure = null, r.leaseToken = null,
                r.leaseUntil = null, r.updatedAt = :now
            where r.id = :id and r.leaseToken = :token and r.status = 'running'
            """)
    int complete(UUID id, UUID token, String status, String model, String result, Instant now);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            update ReadingPronunciationReportEntity r
            set r.status = :status, r.failure = :failure, r.leaseToken = null, r.leaseUntil = null, r.updatedAt = :now
            where r.id = :id and r.leaseToken = :token and r.status = 'running'
            """)
    int fail(UUID id, UUID token, String status, String failure, Instant now);
}
