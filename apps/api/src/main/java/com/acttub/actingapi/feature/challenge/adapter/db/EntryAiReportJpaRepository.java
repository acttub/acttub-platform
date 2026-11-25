package com.acttub.actingapi.feature.challenge.adapter.db;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

import com.acttub.actingapi.feature.challenge.schema.EntryAiReportEntity;
import com.acttub.actingapi.platform.schema.EntryAiReportStatus;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;
import tools.jackson.databind.JsonNode;

/** {@code entry_ai_reports} 를 읽고 쓰는 문장(apps/api/CONTRACT.md §5-9). 참여작당 한 행이다. */
interface EntryAiReportJpaRepository extends Repository<EntryAiReportEntity, UUID> {

    record Row(EntryAiReportStatus status, int attemptCount, JsonNode result, Instant requestedAt, Instant completedAt) { }

    /** 그 참여작의 리포트 행을 잡는다 — 같은 참여작의 동시 요청이 여기서 줄을 선다. */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select r.status from EntryAiReportEntity r where r.entryId = :entryId")
    Optional<EntryAiReportStatus> lockStatus(UUID entryId);

    /** 새 생성을 연다. 그 참여작의 행이 이미 있으면(실패한 생성) 같은 행을 새 작업으로 덮고 결과·모델·끝난 시각을 비운다. */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            insert into EntryAiReportEntity (id, entryId, userId, jobId, status, formatVersion, attemptCount, requestedAt)
            values (:id, :entryId, :userId, :jobId, :pending, :formatVersion, 0, :now)
            on conflict (entryId) do update
            set jobId = excluded.jobId, status = excluded.status, attemptCount = 0, result = null, model = null,
                formatVersion = excluded.formatVersion, requestedAt = excluded.requestedAt, completedAt = null
            """)
    int start(UUID id, UUID entryId, UUID userId, UUID jobId, EntryAiReportStatus pending, int formatVersion, Instant now);

    /** 그 회원의 지우지 않은 참여작에 딸린 리포트. */
    @Query("""
            select new com.acttub.actingapi.feature.challenge.adapter.db.EntryAiReportJpaRepository$Row(
                r.status, r.attemptCount, r.result, r.requestedAt, r.completedAt)
            from EntryAiReportEntity r join ChallengeEntryEntity e on e.id = r.entryId
            where r.entryId = :entryId and e.userId = :owner and e.status <> DELETED
            """)
    Optional<Row> findOwned(UUID entryId, UUID owner);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            update EntryAiReportEntity r
            set r.status = READY, r.result = :result, r.model = :model, r.attemptCount = :attempts, r.completedAt = :now
            where r.entryId = :entryId
            """)
    int complete(UUID entryId, JsonNode result, String model, int attempts, Instant now);

    /** 다시 돌릴 실패 — 시도 수만 적는다. 이 작업이 더는 현재 생성이 아니면 0행이다. */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            update EntryAiReportEntity r set r.attemptCount = :attempts
            where r.entryId = :entryId and r.jobId = :jobId and r.status = PENDING
            """)
    int countAttempt(UUID entryId, UUID jobId, int attempts);

    /** 마지막 실패 — 시도 수를 적고 failed 로 닫는다. */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            update EntryAiReportEntity r set r.attemptCount = :attempts, r.status = FAILED
            where r.entryId = :entryId and r.jobId = :jobId and r.status = PENDING
            """)
    int closeFailed(UUID entryId, UUID jobId, int attempts);

    /** 참여작을 지웠다 — 본문·비교 자료를 파기하고 행은 이력으로 남긴다. */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("update EntryAiReportEntity r set r.result = null, r.purgedAt = :now where r.entryId = :entryId")
    int purge(UUID entryId, Instant now);

    /** 파기한 지 보관 기간이 지난 리포트의 이력을 지운다. */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("delete from EntryAiReportEntity r where r.purgedAt < :before")
    int deletePurgedBefore(Instant before);
}
