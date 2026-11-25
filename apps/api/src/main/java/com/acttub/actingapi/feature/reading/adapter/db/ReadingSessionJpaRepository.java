package com.acttub.actingapi.feature.reading.adapter.db;

import java.util.Optional;
import java.util.UUID;

import com.acttub.actingapi.feature.reading.schema.ReadingSessionEntity;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;

/** {@code reading_sessions} 를 읽고 쓰는 문장(apps/api/CONTRACT.md §5-9). 잠그는 조회는 방언 덕에 {@code for update} 로 나간다(§5-2). */
interface ReadingSessionJpaRepository extends Repository<ReadingSessionEntity, UUID> {

    /** 회차의 대본과 구간, 내 배역. */
    interface Range {
        UUID getScriptId();

        UUID getStartLineId();

        UUID getEndLineId();

        UUID[] getMyCharacterIds();
    }

    @Query("""
            select rs.scriptId as scriptId, rs.startLineId as startLineId, rs.endLineId as endLineId,
                   rs.myCharacterIds as myCharacterIds
            from ReadingSessionEntity rs
            where rs.id = :sessionId and rs.userId = :userId
            """)
    Optional<Range> range(UUID sessionId, UUID userId);

    @Query("select rs.scriptId from ReadingSessionEntity rs where rs.id = :sessionId and rs.userId = :userId")
    Optional<UUID> scriptOf(UUID sessionId, UUID userId);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select rs.id from ReadingSessionEntity rs where rs.id = :sessionId and rs.userId = :userId")
    Optional<UUID> lockOwned(UUID sessionId, UUID userId);

    /** 회원이 같은 요청 id 의 회차를 갖고 있으면 게스트 쪽 값을 비운다(이관). */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            update ReadingSessionEntity guest
            set guest.requestId = null
            where guest.userId = :from
              and guest.requestId is not null
              and exists (select 1 from ReadingSessionEntity member
                          where member.userId = :to and member.requestId = guest.requestId)
            """)
    int clearClashingRequestIds(UUID from, UUID to);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("update ReadingSessionEntity rs set rs.userId = :to where rs.userId = :from")
    int reassign(UUID from, UUID to);
}
