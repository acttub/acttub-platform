package com.acttub.actingapi.feature.reading.adapter.db;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import com.acttub.actingapi.feature.reading.schema.ReadingSessionEntity;
import com.acttub.actingapi.platform.schema.ReadingAdvance;
import com.acttub.actingapi.platform.schema.ReadingMode;
import com.acttub.actingapi.platform.schema.ReadingSessionStatus;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;
import tools.jackson.databind.JsonNode;

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

    /** 카드의 칸과 집계 — 회차 번호, 내 배역, 구간의 대사 번호, 내 대사 수, 녹음된 줄 수. 저장하지 않고 조회할 때 센다. */
    interface Card {
        UUID getId();

        ReadingSessionStatus getStatus();

        int getElapsedSeconds();

        Instant getStartedAt();

        Instant getEndedAt();

        UUID getCurrentLineId();

        long getOrdinal();

        UUID[] getMyCharacterIds();

        /** 배역 순서로 {@code sep} 을 끼워 이은 이름. 내 배역이 없으면 {@code null}. */
        String getMyCharacterNames();

        long getStartDialogueNo();

        long getEndDialogueNo();

        long getMyDialogueCount();

        long getRecordedLineCount();
    }

    /** 카드에 회차의 속성과 진행을 더한 것. */
    interface Detail extends Card {
        UUID getScriptId();

        ReadingMode getMode();

        ReadingAdvance getAdvance();

        Boolean getRecord();

        UUID getStartLineId();

        UUID getEndLineId();

        long getProgressSeq();

        JsonNode getLineResults();

        JsonNode getLineSaid();
    }

    String CARD_SELECT = """
            select rs.id as id, rs.status as status, rs.elapsedSeconds as elapsedSeconds, rs.startedAt as startedAt,
                   rs.endedAt as endedAt, rs.currentLineId as currentLineId,
                   (select count(*) from ReadingSessionEntity o
                    where o.scriptId = rs.scriptId and (o.startedAt, o.id) <= (rs.startedAt, rs.id)) as ordinal,
                   rs.myCharacterIds as myCharacterIds,
                   (select listagg(c.name, :sep) within group (order by c.sortOrder) from ScriptCharacterEntity c
                    where array_contains(rs.myCharacterIds, c.id)) as myCharacterNames,
                   (select count(*) from ScriptLineEntity l
                    where l.scriptId = rs.scriptId and l.kind = com.acttub.actingapi.platform.schema.ScriptLineKind.DIALOGUE
                      and l.ordinal <= sl.ordinal) as startDialogueNo,
                   (select count(*) from ScriptLineEntity l
                    where l.scriptId = rs.scriptId and l.kind = com.acttub.actingapi.platform.schema.ScriptLineKind.DIALOGUE
                      and l.ordinal <= el.ordinal) as endDialogueNo,
                   (select count(*) from ScriptLineEntity l
                    where l.scriptId = rs.scriptId and l.kind = com.acttub.actingapi.platform.schema.ScriptLineKind.DIALOGUE
                      and l.ordinal between sl.ordinal and el.ordinal
                      and (array_contains(rs.myCharacterIds, l.characterId)
                           or exists (select 1 from ScriptCharacterEntity lc
                                      where lc.id = l.characterId
                                        and array_overlaps(lc.memberIds, rs.myCharacterIds)))) as myDialogueCount,
                   (select count(distinct r.lineId) from ReadingRecordingEntity r
                    where r.readingSessionId = rs.id) as recordedLineCount
            """;

    String CARD_FROM = """
            from ReadingSessionEntity rs
            join ScriptLineEntity sl on sl.id = rs.startLineId
            join ScriptLineEntity el on el.id = rs.endLineId
            """;

    @Query(CARD_SELECT + """
                   , rs.scriptId as scriptId, rs.mode as mode, rs.advance as advance, rs.record as record,
                   rs.startLineId as startLineId, rs.endLineId as endLineId, rs.progressSeq as progressSeq,
                   rs.lineResults as lineResults, rs.lineSaid as lineSaid
            """ + CARD_FROM + "where rs.id = :sessionId and rs.userId = :userId")
    Optional<Detail> detail(UUID sessionId, UUID userId, String sep);

    @Query(CARD_SELECT + CARD_FROM + """
            where rs.scriptId = :scriptId and rs.userId = :userId
            order by rs.startedAt desc, rs.id desc
            """)
    List<Card> cards(UUID scriptId, UUID userId, String sep);

    /** 같은 요청 id 로 이미 시작한 회차의 계획. */
    interface Planned {
        UUID getId();

        UUID getScriptId();

        UUID[] getMyCharacterIds();

        ReadingMode getMode();

        UUID getStartLineId();

        UUID getEndLineId();

        ReadingAdvance getAdvance();

        Boolean getRecord();
    }

    @Query("""
            select rs.id as id, rs.scriptId as scriptId, rs.myCharacterIds as myCharacterIds, rs.mode as mode,
                   rs.startLineId as startLineId, rs.endLineId as endLineId, rs.advance as advance, rs.record as record
            from ReadingSessionEntity rs
            where rs.userId = :userId and rs.requestId = :requestId
            """)
    Optional<Planned> byRequest(UUID userId, UUID requestId);

    /** 진행 중·시작 줄에서·0초·순번 0·빈 결과로 시작한다. 말한 것({@code line_said})은 DB 기본값(빈 객체)이다. */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            insert into ReadingSessionEntity (id, scriptId, userId, requestId, myCharacterIds, mode, startLineId, endLineId,
                                              advance, record, status, currentLineId, elapsedSeconds, progressSeq, lineResults,
                                              startedAt, updatedAt)
            values (:id, :scriptId, :userId, :requestId, :myCharacterIds, :mode, :startLineId, :endLineId,
                    :advance, :record, com.acttub.actingapi.platform.schema.ReadingSessionStatus.IN_PROGRESS, :startLineId, 0, 0,
                    :lineResults, :now, :now)
            """)
    int insert(UUID id, UUID scriptId, UUID userId, UUID requestId, UUID[] myCharacterIds, ReadingMode mode, UUID startLineId,
            UUID endLineId, ReadingAdvance advance, boolean record, JsonNode lineResults, Instant now);

    /** 진행 저장이 잠가 읽는 지금 값. */
    interface ProgressState {
        UUID getScriptId();

        ReadingSessionStatus getStatus();

        UUID getStartLineId();

        UUID getEndLineId();

        UUID getCurrentLineId();

        int getElapsedSeconds();

        long getProgressSeq();

        JsonNode getLineResults();

        JsonNode getLineSaid();
    }

    /** 같은 회차의 진행 저장이 여기서 줄을 선다. 방언 덕에 {@code for update} 로 나간다(§5-2). */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("""
            select rs.scriptId as scriptId, rs.status as status, rs.startLineId as startLineId, rs.endLineId as endLineId,
                   rs.currentLineId as currentLineId, rs.elapsedSeconds as elapsedSeconds, rs.progressSeq as progressSeq,
                   rs.lineResults as lineResults, rs.lineSaid as lineSaid
            from ReadingSessionEntity rs
            where rs.id = :sessionId and rs.userId = :userId
            """)
    Optional<ProgressState> lockProgress(UUID sessionId, UUID userId);

    /** @param complete 완료 저장이면 끝난 시각을 적는다. 아니면 그대로 둔다 */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            update ReadingSessionEntity rs
            set rs.currentLineId = :currentLineId, rs.elapsedSeconds = :elapsedSeconds, rs.progressSeq = :progressSeq,
                rs.lineResults = :lineResults, rs.lineSaid = :lineSaid, rs.status = :status,
                rs.endedAt = case when :complete = true then :now else rs.endedAt end, rs.updatedAt = :now
            where rs.id = :sessionId
            """)
    int saveProgress(UUID sessionId, UUID currentLineId, int elapsedSeconds, long progressSeq, JsonNode lineResults,
            JsonNode lineSaid, ReadingSessionStatus status, boolean complete, Instant now);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("delete from ReadingSessionEntity rs where rs.id = :sessionId")
    int delete(UUID sessionId);

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

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            update ReadingSessionEntity rs
            set rs.startLineId = :startLineId, rs.endLineId = :endLineId, rs.currentLineId = :currentLineId
            where rs.id = :sessionId
            """)
    int moveRange(UUID sessionId, UUID startLineId, UUID endLineId, UUID currentLineId);

    /** 구간이 그 줄로 끝나던 회차의 끝을 새 줄로 옮긴다(줄 나누기). */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            update ReadingSessionEntity rs set rs.endLineId = :newEndLineId
            where rs.scriptId = :scriptId and rs.endLineId = :lineId
            """)
    int extendEnd(UUID scriptId, UUID lineId, UUID newEndLineId);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("delete from ReadingSessionEntity rs where rs.scriptId = :scriptId")
    int deleteOfScript(UUID scriptId);

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
