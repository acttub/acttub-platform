package com.acttub.actingapi.feature.reading.adapter.db;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import com.acttub.actingapi.feature.reading.schema.ReadingRecordingEntity;
import com.acttub.actingapi.platform.schema.TranscriptSource;
import jakarta.persistence.LockModeType;
import org.springframework.data.domain.Limit;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;

/** {@code reading_recordings} 를 읽고 쓰는 문장(apps/api/CONTRACT.md §5-9). */
interface ReadingRecordingJpaRepository extends Repository<ReadingRecordingEntity, UUID> {

    /** 응답에 싣는 녹음의 칸과 객체 키. */
    interface Row {
        UUID getId();

        UUID getLineId();

        int getAttemptNo();

        int getDurationMs();

        String getContentType();

        long getByteSize();

        String getTranscript();

        TranscriptSource getTranscriptSource();

        Boolean getMatched();

        String getObjectKey();
    }

    String ROW = """
            select r.id as id, r.lineId as lineId, r.attemptNo as attemptNo, r.durationMs as durationMs,
                   r.contentType as contentType, r.byteSize as byteSize, r.transcript as transcript,
                   r.transcriptSource as transcriptSource, r.matched as matched, r.objectKey as objectKey
            from ReadingRecordingEntity r
            """;

    @Query(ROW + "where r.id = :id")
    Optional<Row> row(UUID id);

    @Query(ROW + "where r.userId = :userId and r.requestId = :requestId")
    Optional<Row> byRequest(UUID userId, UUID requestId);

    @Query(ROW + "where r.readingSessionId = :sessionId and r.lineId = :lineId")
    Optional<Row> byLine(UUID sessionId, UUID lineId);

    /** 같은 줄의 올리기가 겹치면 여기서 줄을 선다. 방언 덕에 {@code for update} 로 나간다(§5-2). */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query(ROW + "where r.readingSessionId = :sessionId and r.lineId = :lineId")
    Optional<Row> lockByLine(UUID sessionId, UUID lineId);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select r.objectKey from ReadingRecordingEntity r where r.id = :id and r.userId = :userId")
    Optional<String> lockObjectKey(UUID id, UUID userId);

    @Query("select coalesce(sum(r.byteSize), 0) from ReadingRecordingEntity r where r.userId = :userId")
    long storedBytes(UUID userId);

    /** 그 키를 이 회차의 행이나 회차 연결이 빈 보관 행이 가리키는가. */
    @Query("""
            select r.id from ReadingRecordingEntity r
            where (r.readingSessionId = :sessionId or r.readingSessionId is null) and r.objectKey = :objectKey
            """)
    List<UUID> pointingAt(UUID sessionId, String objectKey, Limit limit);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            insert into ReadingRecordingEntity (id, userId, readingSessionId, lineId, requestId, attemptNo, objectKey, contentType,
                                                byteSize, durationMs, transcript, transcriptSource, matched, createdAt, updatedAt)
            values (:id, :userId, :sessionId, :lineId, :requestId, :attemptNo, :objectKey, :contentType,
                    :byteSize, :durationMs, :transcript, :transcriptSource, :matched, :now, :now)
            """)
    int insert(UUID id, UUID userId, UUID sessionId, UUID lineId, UUID requestId, int attemptNo, String objectKey,
            String contentType, long byteSize, int durationMs, String transcript, TranscriptSource transcriptSource,
            Boolean matched, Instant now);

    /** 같은 줄의 다시 말하기 — 행은 하나이고 요청·시도 번호·객체·전사를 바꾼다. */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            update ReadingRecordingEntity r
            set r.requestId = :requestId, r.attemptNo = :attemptNo, r.objectKey = :objectKey, r.contentType = :contentType,
                r.byteSize = :byteSize, r.durationMs = :durationMs, r.transcript = :transcript,
                r.transcriptSource = :transcriptSource, r.matched = :matched, r.updatedAt = :now
            where r.id = :id
            """)
    int replace(UUID id, UUID requestId, int attemptNo, String objectKey, String contentType, long byteSize, int durationMs,
            String transcript, TranscriptSource transcriptSource, Boolean matched, Instant now);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("delete from ReadingRecordingEntity r where r.id = :id")
    int delete(UUID id);

    /** 녹음한 줄과 그 줄을 말할 때의 글. */
    interface Spoken {
        int getLineNo();

        String getText();

        String getTranscript();

        String getObjectKey();

        String getContentType();

        Integer getDurationMs();
    }

    /** 그 회차의 녹음, 대본 순서. 글은 읽는 글(speech)이 있으면 말 표시(⟦ko⟧ 같은)를 빈칸으로 바꾼 것이고 없으면 원문이다. */
    @Query("""
            select l.ordinal as lineNo,
                   coalesce(regexp_replace(l.speech, '⟦[a-z][a-z]⟧', ' ', 'g'), l.text) as text,
                   r.transcript as transcript, r.objectKey as objectKey, r.contentType as contentType,
                   r.durationMs as durationMs
            from ReadingRecordingEntity r join ScriptLineEntity l on l.id = r.lineId
            where r.readingSessionId = :sessionId
            order by l.ordinal
            """)
    List<Spoken> spokenLines(UUID sessionId);

    /**
     * 그 녹음을 저장할 때 대조한 원문과 같은 글 — 회차 연습 구간 안의 내 대사 줄(내 배역이 든 함께 말하는 줄 포함)이 아니면
     * 비어 있다. native 의 {@code = ANY(배열 칸)} 은 HQL 에 없어 {@code array_contains}({@code @>})로 쓴다.
     */
    @Query("""
            select coalesce(regexp_replace(l.speech, '⟦[a-z][a-z]⟧', ' ', 'g'), l.text)
            from ReadingRecordingEntity r
            join ReadingSessionEntity rs on rs.id = r.readingSessionId
            join ScriptLineEntity s on s.id = rs.startLineId
            join ScriptLineEntity e on e.id = rs.endLineId
            join ScriptLineEntity l on l.id = r.lineId and l.scriptId = rs.scriptId
            where r.id = :id
              and l.kind = com.acttub.actingapi.platform.schema.ScriptLineKind.DIALOGUE
              and l.ordinal between s.ordinal and e.ordinal
              and (array_contains(rs.myCharacterIds, l.characterId)
                   or exists (select 1 from ScriptCharacterEntity lc
                              where lc.id = l.characterId and array_overlaps(lc.memberIds, rs.myCharacterIds)))
            """)
    List<String> myLineText(UUID id);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("update ReadingRecordingEntity r set r.userId = :to where r.userId = :from")
    int reassign(UUID from, UUID to);
}
