package com.acttub.actingapi.feature.reading.adapter.db;

import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.reading.schema.ScriptLineEntity;
import com.acttub.actingapi.platform.schema.ScriptLineKind;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;

/** {@code script_lines} 를 읽고 쓰는 문장(apps/api/CONTRACT.md §5-9). */
interface ScriptLineJpaRepository extends Repository<ScriptLineEntity, UUID> {

    /** 줄과 그 배역의 이름. 지문·장면은 배역이 없다. */
    interface Cast {
        UUID getId();

        int getOrdinal();

        ScriptLineKind getKind();

        String getText();

        UUID getCharacterId();

        String getCharacterName();
    }

    /** 구간은 시작 줄과 끝 줄의 순번 사이다. 대본을 고쳐 끝 줄이 사라졌으면 대본 끝까지로 본다. */
    @Query("""
            select l.id as id, l.ordinal as ordinal, l.kind as kind, l.text as text, l.characterId as characterId,
                   c.name as characterName
            from ScriptLineEntity l left join ScriptCharacterEntity c on c.id = l.characterId
            where l.scriptId = :scriptId
              and l.ordinal >= coalesce((select s.ordinal from ScriptLineEntity s where s.id = :startLineId), 0)
              and l.ordinal <= coalesce((select e.ordinal from ScriptLineEntity e where e.id = :endLineId), 2147483647)
            order by l.ordinal
            """)
    List<Cast> castInRange(UUID scriptId, UUID startLineId, UUID endLineId);
}
