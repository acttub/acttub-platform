package com.acttub.actingapi.feature.reading.adapter.db;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import com.acttub.actingapi.feature.reading.schema.ScriptLineEntity;
import com.acttub.actingapi.platform.schema.ScriptLineKind;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
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

    /** 줄의 순서·종류·배역. */
    interface Outline {
        UUID getId();

        int getOrdinal();

        ScriptLineKind getKind();

        UUID getCharacterId();
    }

    @Query("""
            select l.id as id, l.ordinal as ordinal, l.kind as kind, l.characterId as characterId
            from ScriptLineEntity l where l.scriptId = :scriptId order by l.ordinal
            """)
    List<Outline> outline(UUID scriptId);

    /** 잠근 줄의 순번·종류·배역. */
    interface Locked {
        int getOrdinal();

        ScriptLineKind getKind();

        UUID getCharacterId();
    }

    /** 방언 덕에 {@code for update} 로 나간다(§5-2). 이 잠금이 그 줄을 가리키는 새 녹음·암기 표시·회차를 막는다. */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("""
            select l.ordinal as ordinal, l.kind as kind, l.characterId as characterId
            from ScriptLineEntity l where l.id = :lineId and l.scriptId = :scriptId
            """)
    Optional<Locked> lock(UUID lineId, UUID scriptId);

    @Query("select count(*) from ScriptLineEntity l where l.scriptId = :scriptId and l.id <> :lineId")
    long countOthers(UUID scriptId, UUID lineId);

    /** 줄의 id 와 순번. */
    interface Numbered {
        UUID getId();

        int getOrdinal();
    }

    /** 그 줄을 뺀, 순번 구간 안의 대사 줄. */
    @Query("""
            select l.id as id, l.ordinal as ordinal from ScriptLineEntity l
            where l.scriptId = :scriptId and l.kind = com.acttub.actingapi.platform.schema.ScriptLineKind.DIALOGUE
              and l.id <> :lineId and l.ordinal between :from and :to
            order by l.ordinal
            """)
    List<Numbered> dialoguesBetween(UUID scriptId, UUID lineId, int from, int to);

    /** 글이 {@code null} 이거나 지금 글과 같으면 말과 읽을 글을 그대로 두고, 바뀌면 비운다. */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            update ScriptLineEntity l
            set l.kind = :kind, l.characterId = :characterId, l.text = coalesce(:text, l.text),
                l.lang = case when :text is null or :text = l.text then l.lang end,
                l.speech = case when :text is null or :text = l.text then l.speech end
            where l.id = :lineId
            """)
    int edit(UUID lineId, ScriptLineKind kind, UUID characterId, String text);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            update ScriptLineEntity l
            set l.text = :text,
                l.lang = case when :text = l.text then l.lang end,
                l.speech = case when :text = l.text then l.speech end
            where l.id = :lineId
            """)
    int retext(UUID lineId, String text);

    /**
     * 순번 유일 제약은 줄마다 바로 검사돼 +1 을 한 번에 못 한다 — {@code ordinal} 뒤의 줄을 음수로 비켜 둔다.
     * {@link #shiftBack} 이 되돌린다.
     */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("update ScriptLineEntity l set l.ordinal = -(l.ordinal + 1) where l.scriptId = :scriptId and l.ordinal > :ordinal")
    int shiftAway(UUID scriptId, int ordinal);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("update ScriptLineEntity l set l.ordinal = -l.ordinal where l.scriptId = :scriptId and l.ordinal < 0")
    int shiftBack(UUID scriptId);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            insert into ScriptLineEntity (id, scriptId, ordinal, kind, characterId, text)
            values (:id, :scriptId, :ordinal, :kind, :characterId, :text)
            """)
    int insert(UUID id, UUID scriptId, int ordinal, ScriptLineKind kind, UUID characterId, String text);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("delete from ScriptLineEntity l where l.id = :lineId")
    int delete(UUID lineId);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("delete from ScriptLineEntity l where l.scriptId = :scriptId")
    int deleteOfScript(UUID scriptId);

    /** 줄의 모든 내용. */
    interface Content {
        UUID getId();

        int getOrdinal();

        ScriptLineKind getKind();

        UUID getCharacterId();

        String getText();

        String getLang();

        String getSpeech();
    }

    @Query("""
            select l.id as id, l.ordinal as ordinal, l.kind as kind, l.characterId as characterId, l.text as text,
                   l.lang as lang, l.speech as speech
            from ScriptLineEntity l where l.scriptId = :scriptId order by l.ordinal
            """)
    List<Content> content(UUID scriptId);

    /** 줄의 종류, 장면 머리의 글, 구간 안 대사 줄의 소리 낼 글. */
    interface Reading {
        UUID getId();

        ScriptLineKind getKind();

        String getHeading();

        String getSpoken();
    }

    /**
     * 대본 줄을 한 번 읽어 표시값(장면 이름)과 구간 대사를 함께 낸다. 글은 장면 머리와 구간 안 대사만 읽는다. 구간이
     * 없으면({@code null}) 구간 대사도 없다.
     */
    @Query("""
            select l.id as id, l.kind as kind,
                   case when l.kind = com.acttub.actingapi.platform.schema.ScriptLineKind.SCENE then l.text end as heading,
                   case when l.kind = com.acttub.actingapi.platform.schema.ScriptLineKind.DIALOGUE
                         and l.ordinal between (select s.ordinal from ScriptLineEntity s where s.id = :startLineId)
                                           and (select e.ordinal from ScriptLineEntity e where e.id = :endLineId)
                        then coalesce(regexp_replace(l.speech, '⟦[a-z][a-z]⟧', ' ', 'g'), l.text) end as spoken
            from ScriptLineEntity l
            where l.scriptId = :scriptId
            order by l.ordinal
            """)
    List<Reading> reading(UUID scriptId, UUID startLineId, UUID endLineId);

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
