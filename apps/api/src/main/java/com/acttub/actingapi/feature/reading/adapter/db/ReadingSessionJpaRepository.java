package com.acttub.actingapi.feature.reading.adapter.db;

import java.util.Optional;
import java.util.UUID;

import com.acttub.actingapi.feature.reading.schema.ReadingSessionEntity;
import com.acttub.actingapi.platform.schema.ReadingSessionStatus;
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

    @Query("select rs.status from ReadingSessionEntity rs where rs.id = :sessionId and rs.userId = :userId")
    Optional<ReadingSessionStatus> statusOf(UUID sessionId, UUID userId);

    @Query("select rs.scriptId from ReadingSessionEntity rs where rs.id = :sessionId and rs.userId = :userId")
    Optional<UUID> scriptOf(UUID sessionId, UUID userId);

    /** 이 회차가 그 사람이 가장 먼저 시작한 회차인가(같은 시각이면 id 가 작은 것). 내 회차가 아니거나 없으면 false. */
    @Query("""
            select exists (select 1 from ReadingSessionEntity s
                           where s.id = :sessionId and s.userId = :userId
                             and not exists (select 1 from ReadingSessionEntity e
                                             where e.userId = s.userId and (e.startedAt, e.id) < (s.startedAt, s.id)))
            """)
    boolean isFirstOf(UUID userId, UUID sessionId);

    /** 내 대본이고 내 회차가 아직 하나도 없는가. */
    @Query("""
            select exists (select 1 from ScriptEntity s where s.id = :scriptId and s.userId = :userId)
               and not exists (select 1 from ReadingSessionEntity r where r.userId = :userId)
            """)
    boolean noneYetFor(UUID userId, UUID scriptId);

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
