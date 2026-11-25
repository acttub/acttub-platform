package com.acttub.actingapi.feature.reading.adapter.db;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import com.acttub.actingapi.feature.reading.schema.ScriptCocreationEntity;
import jakarta.persistence.LockModeType;
import org.springframework.data.domain.Limit;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;

/**
 * {@code script_cocreations} 를 읽고 쓰는 문장(apps/api/CONTRACT.md §5-9). 겹친 생성은 (사람, 요청 id) 유일 제약이, 겹친
 * 수정은 조건부 UPDATE 한 문장이 가른다 — 영향 행 수가 승패다.
 */
interface ScriptCocreationJpaRepository extends Repository<ScriptCocreationEntity, UUID> {

    @Query("select c from ScriptCocreationEntity c where c.id = :id and c.userId = :userId")
    Optional<ScriptCocreationEntity> find(UUID id, UUID userId);

    /** 방언 덕에 {@code for update} 로 나간다(§5-2). */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select c from ScriptCocreationEntity c where c.id = :id and c.userId = :userId")
    Optional<ScriptCocreationEntity> lock(UUID id, UUID userId);

    @Query("select c from ScriptCocreationEntity c where c.userId = :userId and c.requestId = :requestId")
    Optional<ScriptCocreationEntity> findByRequest(UUID userId, UUID requestId);

    @Query("select count(*) from ScriptCocreationEntity c where c.userId = :userId and c.createdAt >= :since")
    long countSince(UUID userId, Instant since);

    @Query("""
            select c.conditions from ScriptCocreationEntity c
            where c.userId = :userId and c.conditions is not null
            order by c.createdAt desc
            """)
    List<String> recentConditions(UUID userId, Limit limit);

    /** 같은 (사람, 요청 id) 가 있으면 0행이다. 함께 넣는 다른 트랜잭션이 있으면 그 커밋을 기다렸다가 판정한다. */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            insert into ScriptCocreationEntity (id, userId, requestId, createdAt, updatedAt)
            values (:id, :userId, :requestId, :now, :now)
            on conflict (userId, requestId) do nothing
            """)
    int insertPending(UUID id, UUID userId, UUID requestId, Instant now);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("delete from ScriptCocreationEntity c where c.id = :id and c.versions is null")
    int deletePending(UUID id);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            update ScriptCocreationEntity c
            set c.conditions = :conditions, c.versions = :versions, c.currentVersion = 1, c.model = :model, c.updatedAt = :now
            where c.id = :id
            """)
    int complete(UUID id, String conditions, String versions, String model, Instant now);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            update ScriptCocreationEntity c
            set c.busySince = :now, c.updatedAt = :now
            where c.id = :id and c.userId = :userId and c.versions is not null and c.currentVersion = :version
              and c.scriptId is null and c.revisionsUsed < :revisionLimit
              and (c.busySince is null or c.busySince < :staleBefore)
            """)
    int claim(UUID userId, UUID id, int version, int revisionLimit, Instant now, Instant staleBefore);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("update ScriptCocreationEntity c set c.busySince = null where c.id = :id")
    int release(UUID id);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            update ScriptCocreationEntity c
            set c.versions = :versions, c.currentVersion = :currentVersion, c.revisionsUsed = c.revisionsUsed + 1,
                c.busySince = null, c.updatedAt = :now
            where c.id = :id and c.scriptId is null and c.busySince is not null
            """)
    int appendVersion(UUID id, String versions, int currentVersion, Instant now);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            update ScriptCocreationEntity c
            set c.currentVersion = :version, c.updatedAt = :now
            where c.id = :id and c.userId = :userId and c.versions is not null and c.scriptId is null and c.busySince is null
            """)
    int restore(UUID userId, UUID id, int version, Instant now);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            update ScriptCocreationEntity c set c.scriptId = :scriptId, c.updatedAt = :now
            where c.id = :id and c.userId = :userId
            """)
    int linkScript(UUID userId, UUID id, UUID scriptId, Instant now);
}
