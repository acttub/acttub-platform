package com.acttub.actingapi.feature.coach.adapter.db;

import java.time.Instant;
import java.util.UUID;

import com.acttub.actingapi.feature.coach.schema.ActorJournalEntity;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;

/** {@code actor_journals} 한 표만 쓰는 문장. 화면 머리(제목·목적·배역)를 함께 읽는 조회는 {@link PostgresJournalRepository} 의 native 다. */
interface ActorJournalJpaRepository extends Repository<ActorJournalEntity, UUID> {

    /** 만드는 중 줄을 넣는다. 같은 회차에 이미 있으면 넣지 않는다(0). */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            insert into ActorJournalEntity (id, userId, practiceId, conversationId, answers, draftStatus, createdAt, updatedAt)
            values (:id, :userId, :practiceId, :conversationId, :answers, 'pending', :now, :now)
            on conflict (practiceId) do nothing
            """)
    int insertPending(UUID id, UUID userId, UUID practiceId, UUID conversationId, String answers, Instant now);

    /** 아직 만드는 중이고 배우가 고치지 않은 줄에만 쓴다 — 늦게 끝난 생성이 고친 일지를 덮지 않는다. */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            update ActorJournalEntity j
            set j.draftStatus = :status, j.draft = :draft, j.model = :model, j.updatedAt = :now
            where j.id = :id and j.draftStatus = 'pending' and j.editedAt is null
            """)
    int complete(UUID id, String status, String draft, String model, Instant now);

    /** 배우가 고친다. 만드는 중이던 줄은 ready 가 된다. */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            update ActorJournalEntity j
            set j.answers = :answers, j.draft = :draft,
                j.draftStatus = case when j.draftStatus = 'pending' then 'ready' else j.draftStatus end,
                j.editedAt = :now, j.updatedAt = :now
            where j.practiceId = :practiceId and j.userId = :userId
            """)
    int edit(UUID userId, UUID practiceId, String answers, String draft, Instant now);
}
