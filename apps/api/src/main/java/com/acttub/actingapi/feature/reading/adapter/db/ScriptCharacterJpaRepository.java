package com.acttub.actingapi.feature.reading.adapter.db;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import com.acttub.actingapi.feature.reading.schema.ScriptCharacterEntity;
import com.acttub.actingapi.platform.schema.CharacterAgeBand;
import com.acttub.actingapi.platform.schema.CharacterGender;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.repository.Repository;

/** {@code script_characters} 를 읽고 쓰는 문장(apps/api/CONTRACT.md §5-9). */
interface ScriptCharacterJpaRepository extends Repository<ScriptCharacterEntity, UUID> {

    /** 대본 상세의 배역 한 줄. 대사 수는 그 배역의 줄과 그 배역이 든 묶음 배역의 줄을 함께 센다. */
    interface Profile {
        UUID getId();

        String getName();

        int getSortOrder();

        String getVoicePreset();

        CharacterGender getGender();

        CharacterAgeBand getAgeBand();

        UUID[] getMemberIds();

        Boolean getUnnamed();

        long getDialogueCount();
    }

    @Query("""
            select c.id as id, c.name as name, c.sortOrder as sortOrder, c.voicePreset as voicePreset, c.gender as gender,
                   c.ageBand as ageBand, c.memberIds as memberIds, c.unnamed as unnamed,
                   (select count(*) from ScriptLineEntity l join ScriptCharacterEntity lc on lc.id = l.characterId
                    where lc.id = c.id or array_contains(lc.memberIds, c.id)) as dialogueCount
            from ScriptCharacterEntity c
            where c.scriptId = :scriptId
            order by c.sortOrder
            """)
    List<Profile> profiles(UUID scriptId);

    /** 배역의 이름, 배역 순서. */
    interface Named {
        UUID getId();

        String getName();
    }

    @Query("select c.id as id, c.name as name from ScriptCharacterEntity c where c.scriptId = :scriptId order by c.sortOrder")
    List<Named> names(UUID scriptId);

    @Query("select c.id from ScriptCharacterEntity c where c.id = :characterId and c.scriptId = :scriptId")
    Optional<UUID> inScript(UUID characterId, UUID scriptId);

    /**
     * 이름과 목소리를 고친다. 이름이 {@code null} 이면 그대로 두고, 이름을 주면 이름 없는 배역 표시를 내린다. 목소리는
     * {@code voiceSet} 일 때만 넘긴 값으로 바꾼다({@code null} 이면 비운다).
     */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            update ScriptCharacterEntity c
            set c.name = coalesce(:name, c.name),
                c.unnamed = case when c.unnamed = true and :name is null then true else false end,
                c.voicePreset = case when :voiceSet = true then :voicePreset else c.voicePreset end,
                c.updatedAt = instant
            where c.id = :id and c.scriptId = :scriptId
            """)
    int patch(UUID id, UUID scriptId, String name, boolean voiceSet, String voicePreset);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("delete from ScriptCharacterEntity c where c.scriptId = :scriptId")
    int deleteOfScript(UUID scriptId);

    /** 배역과, 함께 말하는 줄의 묶음 배역이면 그 멤버. */
    interface Members {
        UUID getId();

        UUID[] getMemberIds();
    }

    /** 배역의 이름과 특성, 묶음 배역이면 그 멤버. */
    interface Cast {
        UUID getId();

        String getName();

        CharacterGender getGender();

        CharacterAgeBand getAgeBand();

        UUID[] getMemberIds();

        Boolean getUnnamed();
    }

    @Query("""
            select c.id as id, c.name as name, c.gender as gender, c.ageBand as ageBand, c.memberIds as memberIds,
                   c.unnamed as unnamed
            from ScriptCharacterEntity c where c.scriptId = :scriptId order by c.sortOrder
            """)
    List<Cast> cast(UUID scriptId);

    @Query("select c.id as id, c.memberIds as memberIds from ScriptCharacterEntity c where c.scriptId = :scriptId")
    List<Members> members(UUID scriptId);
}
