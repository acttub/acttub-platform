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

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("update ReadingRecordingEntity r set r.userId = :to where r.userId = :from")
    int reassign(UUID from, UUID to);
}
