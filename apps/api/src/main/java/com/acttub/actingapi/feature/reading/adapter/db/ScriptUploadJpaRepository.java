package com.acttub.actingapi.feature.reading.adapter.db;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

import com.acttub.actingapi.feature.reading.schema.ScriptUploadEntity;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;

/** {@code script_uploads} 를 읽고 쓰는 문장(apps/api/CONTRACT.md §5-9). */
interface ScriptUploadJpaRepository extends Repository<ScriptUploadEntity, UUID> {

    /** {@link #find} 가 내는 칸. */
    interface Found {
        UUID getId();

        String getObjectKey();

        long getByteSize();

        String getRawText();

        UUID getScriptId();

        UUID getLinkedRequestId();
    }

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            insert into ScriptUploadEntity (id, userId, objectKey, fileName, byteSize, expiresAt, createdAt, updatedAt)
            values (:id, :userId, :objectKey, :fileName, :byteSize, :expiresAt, :now, :now)
            """)
    int insert(UUID id, UUID userId, String objectKey, String fileName, long byteSize, Instant expiresAt, Instant now);

    /**
     * 연결 때 원본 행의 글은 비우므로 연결된 원본의 글은 그 대본의 원문에서 읽는다 — 대본은 이 글로 만들었다. 연결한 요청은 그
     * 대본으로 이어진 나누기 요청 가운데 가장 먼저 만든 것이다.
     */
    @Query("""
            select u.id as id, u.objectKey as objectKey, u.byteSize as byteSize, coalesce(u.rawText, s.rawText) as rawText,
                   u.scriptId as scriptId,
                   (select i.requestId from ScriptImportEntity i
                    where i.uploadId = u.id and i.scriptId = u.scriptId
                    order by i.createdAt limit 1) as linkedRequestId
            from ScriptUploadEntity u left join ScriptEntity s on s.id = u.scriptId
            where u.id = :id and u.userId = :userId
            """)
    Optional<Found> find(UUID id, UUID userId);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            update ScriptUploadEntity u
            set u.rawText = :rawText, u.failure = null, u.keptUntil = null, u.updatedAt = :now
            where u.id = :id
            """)
    int saveText(UUID id, String rawText, Instant now);
}
