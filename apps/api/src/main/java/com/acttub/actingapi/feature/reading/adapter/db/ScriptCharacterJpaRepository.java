package com.acttub.actingapi.feature.reading.adapter.db;

import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.reading.schema.ScriptCharacterEntity;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;

/** {@code script_characters} 를 읽고 쓰는 문장(apps/api/CONTRACT.md §5-9). */
interface ScriptCharacterJpaRepository extends Repository<ScriptCharacterEntity, UUID> {

    /** 배역과, 함께 말하는 줄의 묶음 배역이면 그 멤버. */
    interface Members {
        UUID getId();

        UUID[] getMemberIds();
    }

    @Query("select c.id as id, c.memberIds as memberIds from ScriptCharacterEntity c where c.scriptId = :scriptId")
    List<Members> members(UUID scriptId);
}
