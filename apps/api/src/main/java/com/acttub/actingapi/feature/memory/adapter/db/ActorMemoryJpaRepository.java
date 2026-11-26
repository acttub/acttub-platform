package com.acttub.actingapi.feature.memory.adapter.db;

import java.util.Collection;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.memory.schema.ActorMemoryEntity;
import com.acttub.actingapi.platform.schema.ActorMemoryField;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;

/**
 * 기억 표 둘({@code actor_memories}, 옛 {@code actor_memory_entries})만 읽고 쓰는 문장. 다른 기능의 표를 함께 보는 문장은
 * {@link PostgresActorMemoryStore} 의 native 에 남았다.
 */
interface ActorMemoryJpaRepository extends Repository<ActorMemoryEntity, UUID> {

    /**
     * 이 사람의 기억 행을 최근 고친 것부터. 새 표에 같은 칸이 없으면 옛 표의 {@code legacy} 칸도 장면 없는 행으로 싣는다.
     *
     * <p>옛 표 쪽 장면 칸은 맨 {@code null} 이다. {@code cast(null as UUID)} 는 UNION 갈래 안에서 Hibernate 7.4 가 해석하지
     * 못한다({@code NoSuchElementException}). SQL 에서는 앞 갈래의 uuid 형을 따른다. 하위 조회로 감싸야 정렬이 UNION 전체에
     * 걸린다 — 감싸지 않은 {@code … union all … order by} 는 정렬을 마지막 갈래 안에 넣어 낸다.
     */
    @Query("""
            select m.field as field, m.value as value, m.writtenBy as writtenBy, m.sceneRootId as sceneRootId
            from (
                select n.field as field, n.value as value, n.writtenBy as writtenBy, n.sceneRootId as sceneRootId,
                       n.updatedAt as updatedAt
                from ActorMemoryEntity n
                where n.userId = :userId
                union all
                select cast(o.field as String), o.value, cast(o.writtenBy as String), null, o.updatedAt
                from ActorMemoryEntryEntity o
                where o.userId = :userId
                  and o.field in :legacy
                  and not exists (select 1 from ActorMemoryEntity newer
                                  where newer.userId = o.userId and newer.field = cast(o.field as String))
            ) m
            order by m.updatedAt desc
            """)
    List<ScopedRow> scopedRows(UUID userId, Collection<ActorMemoryField> legacy);

    /** 두 표의 이 사람 행 수의 합. 옛 표는 칸을 가리지 않는다. */
    @Query("""
            select (select count(n) from ActorMemoryEntity n where n.userId = :userId)
                 + (select count(o) from ActorMemoryEntryEntity o where o.userId = :userId)
            """)
    long countBoth(UUID userId);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("delete from ActorMemoryEntity n where n.userId = :userId")
    int deleteAll(UUID userId);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("delete from ActorMemoryEntity n where n.userId = :userId and n.field = :field")
    int deleteField(UUID userId, String field);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("delete from ActorMemoryEntryEntity o where o.userId = :userId")
    int deleteAllLegacy(UUID userId);

    /** {@code fields} 가 비면 0행이다. */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("delete from ActorMemoryEntryEntity o where o.userId = :userId and o.field in :fields")
    int deleteLegacyFields(UUID userId, Collection<ActorMemoryField> fields);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("update ActorMemoryEntity n set n.userId = :to where n.userId = :from")
    int reassign(UUID from, UUID to);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("update ActorMemoryEntryEntity o set o.userId = :to where o.userId = :from")
    int reassignLegacy(UUID from, UUID to);

    interface ScopedRow {
        String getField();

        String getValue();

        String getWrittenBy();

        UUID getSceneRootId();
    }
}
