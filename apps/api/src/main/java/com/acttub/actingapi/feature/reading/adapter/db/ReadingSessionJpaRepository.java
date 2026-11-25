package com.acttub.actingapi.feature.reading.adapter.db;

import java.util.List;
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

    @Query("select rs.id from ReadingSessionEntity rs where rs.id = :sessionId and rs.userId = :userId")
    Optional<UUID> owned(UUID sessionId, UUID userId);

    /**
     * 그 회차의 구간 안 내 대사 줄(내 배역이 든 함께 말하는 줄 포함)의 소리 낼 글. 상대역 줄·지문·구간 밖·남의 줄이면 비어 있다.
     * native 의 {@code = ANY(배열 칸)} 은 HQL 에 없어 {@code array_contains}({@code @>})로 쓴다.
     */
    @Query("""
            select coalesce(regexp_replace(l.speech, '⟦[a-z][a-z]⟧', ' ', 'g'), l.text)
            from ReadingSessionEntity rs
            join ScriptLineEntity s on s.id = rs.startLineId
            join ScriptLineEntity e on e.id = rs.endLineId
            join ScriptLineEntity l on l.scriptId = rs.scriptId
            where rs.id = :sessionId
              and l.id = :lineId
              and l.kind = com.acttub.actingapi.platform.schema.ScriptLineKind.DIALOGUE
              and l.ordinal between s.ordinal and e.ordinal
              and (array_contains(rs.myCharacterIds, l.characterId)
                   or exists (select 1 from ScriptCharacterEntity lc
                              where lc.id = l.characterId and array_overlaps(lc.memberIds, rs.myCharacterIds)))
            """)
    List<String> myDialogueLine(UUID sessionId, UUID lineId);

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
