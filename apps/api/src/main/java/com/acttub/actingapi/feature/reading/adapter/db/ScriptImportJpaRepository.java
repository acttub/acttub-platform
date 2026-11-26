package com.acttub.actingapi.feature.reading.adapter.db;

import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import com.acttub.actingapi.feature.reading.schema.ScriptImportEntity;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;

/**
 * {@code script_imports} 를 읽고 쓰는 문장(apps/api/CONTRACT.md §5-9). 나누기 작업({@code ai_jobs})을 함께 읽는 문장은
 * 저장소의 native SQL 에 있다.
 */
interface ScriptImportJpaRepository extends Repository<ScriptImportEntity, UUID> {

    /** 같은 요청 id 로 이미 접수한 요청. */
    interface Replay {
        UUID getId();

        String getRequestFingerprint();
    }

    @Query("""
            select i.id as id, i.requestFingerprint as requestFingerprint
            from ScriptImportEntity i where i.userId = :userId and i.requestId = :requestId
            """)
    Optional<Replay> byRequest(UUID userId, UUID requestId);

    /** @param lines 바로 대본을 만든 요청(예시·다시 쓰기)이면 그 줄 수, 나누기를 기다리는 요청이면 0 */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            insert into ScriptImportEntity (id, userId, requestId, requestFingerprint, title, source, rawText, rawHash, jobId,
                                            scriptId, skipScriptCheck, uploadId, doneLines, totalLines, createdAt, updatedAt)
            values (:id, :userId, :requestId, :fingerprint, :title, :source, :rawText, :rawHash, :jobId,
                    :scriptId, :skipScriptCheck, :uploadId, :lines, :lines, :now, :now)
            """)
    int insert(UUID id, UUID userId, UUID requestId, String fingerprint, String title, String source, String rawText,
            String rawHash, UUID jobId, UUID scriptId, boolean skipScriptCheck, UUID uploadId, int lines, Instant now);

    /** 끝나지 않은 요청에만 적는다. 고친 시각은 DB 의 지금이다. */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            update ScriptImportEntity i set i.doneLines = :doneLines, i.totalLines = :totalLines, i.updatedAt = instant
            where i.id = :id and i.scriptId is null and i.failure is null
            """)
    int progress(UUID id, int doneLines, int totalLines);

    /** 진행률은 뒤로 가지 않는다 — 지금 값보다 클 때만 적는다. */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            update ScriptImportEntity i set i.progressPercent = :percent, i.updatedAt = instant
            where i.id = :id and i.scriptId is null and i.failure is null and i.progressPercent < :percent
            """)
    int percent(UUID id, int percent);

    /** 만든 대본을 잇는다 — 줄 수를 다 한 것으로 적고 원문을 비운다(글은 대본에 있다). */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            update ScriptImportEntity i
            set i.scriptId = :scriptId, i.doneLines = i.totalLines, i.rawText = '', i.updatedAt = :now
            where i.id = :id
            """)
    int linkScript(UUID id, UUID scriptId, Instant now);

    /** 실패 이유를 적고 원문을 비운다. 이미 대본이 이어진 요청은 0행이다. */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            update ScriptImportEntity i set i.failure = :failure, i.rawText = '', i.updatedAt = :now
            where i.id = :id and i.scriptId is null
            """)
    int fail(UUID id, String failure, Instant now);

    @Query("select i.uploadId from ScriptImportEntity i where i.id = :id")
    Optional<UUID> uploadOf(UUID id);

    /** 닫힌 작업들의 요청 가운데 아직 끝나지 않은 것을 failed 로 닫는다. */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            update ScriptImportEntity i set i.failure = 'failed', i.rawText = '', i.updatedAt = :now
            where i.jobId in :jobs and i.scriptId is null and i.failure is null
            """)
    int failOfJobs(Collection<UUID> jobs, Instant now);
}
