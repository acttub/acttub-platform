package com.acttub.actingapi.feature.challenge.adapter.db;

import java.util.Optional;
import java.util.UUID;

import com.acttub.actingapi.feature.challenge.schema.EntryCommentEntity;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;

/** {@code entry_comments} 를 읽고 쓰는 문장(apps/api/CONTRACT.md §5-9). */
interface EntryCommentJpaRepository extends Repository<EntryCommentEntity, UUID> {

    /** 보이는 댓글의 앞 40자. 지웠거나 숨긴 댓글은 없다. */
    @Query("select left(c.body, 40) from EntryCommentEntity c where c.id = :id and c.deletedAt is null and c.status = VISIBLE")
    Optional<String> visibleExcerpt(UUID id);
}
