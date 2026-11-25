package com.acttub.actingapi.feature.reading.adapter.db;

import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.reading.schema.ReadingRecordingEntity;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;

/** {@code reading_recordings} 를 읽고 쓰는 문장(apps/api/CONTRACT.md §5-9). */
interface ReadingRecordingJpaRepository extends Repository<ReadingRecordingEntity, UUID> {

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
