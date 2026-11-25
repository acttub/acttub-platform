package com.acttub.actingapi.feature.reading.adapter.db;

import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.reading.schema.ScriptCharacterEntity;
import com.acttub.actingapi.platform.schema.CharacterAgeBand;
import com.acttub.actingapi.platform.schema.CharacterGender;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;

/** {@code script_characters} 를 읽고 쓰는 문장(apps/api/CONTRACT.md §5-9). */
interface ScriptCharacterJpaRepository extends Repository<ScriptCharacterEntity, UUID> {

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
