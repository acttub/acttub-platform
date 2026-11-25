package com.acttub.actingapi.feature.reading.adapter.db;

import java.util.Optional;
import java.util.UUID;

import com.acttub.actingapi.feature.reading.schema.ScriptEntity;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;

/** {@code scripts} 를 읽고 쓰는 문장(apps/api/CONTRACT.md §5-9). 잠그는 조회는 방언 덕에 {@code for update} 로 나간다(§5-2). */
interface ScriptJpaRepository extends Repository<ScriptEntity, UUID> {

    @Query("select s.id from ScriptEntity s where s.id = :scriptId and s.userId = :userId")
    Optional<UUID> owned(UUID scriptId, UUID userId);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select s.id from ScriptEntity s where s.id = :scriptId")
    Optional<UUID> lock(UUID scriptId);

    /** 회원이 같은 요청 id 의 대본을 갖고 있으면 게스트 쪽 값을 비운다(이관). */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            update ScriptEntity guest
            set guest.requestId = null
            where guest.userId = :from
              and guest.requestId is not null
              and exists (select 1 from ScriptEntity member
                          where member.userId = :to and member.requestId = guest.requestId)
            """)
    int clearClashingRequestIds(UUID from, UUID to);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("update ScriptEntity s set s.userId = :to where s.userId = :from")
    int reassign(UUID from, UUID to);
}
