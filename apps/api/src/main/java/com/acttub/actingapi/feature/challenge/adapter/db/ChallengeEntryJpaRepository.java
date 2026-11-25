package com.acttub.actingapi.feature.challenge.adapter.db;

import java.util.Optional;
import java.util.UUID;

import com.acttub.actingapi.feature.challenge.schema.ChallengeEntryEntity;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;

/**
 * {@code challenge_entries} 를 읽고 쓰는 문장(apps/api/CONTRACT.md §5-9). 엔티티가 아니라 값으로 읽는다 — 같은 트랜잭션에
 * 이 표를 고치는 네이티브 SQL 이 남아 있어, 영속성 컨텍스트에 둔 엔티티는 낡은 값을 돌려준다(§5-4).
 */
interface ChallengeEntryJpaRepository extends Repository<ChallengeEntryEntity, UUID> {

    record Parent(UUID userId, UUID challengeId) { }

    record Content(int contentVersion, String caption) { }

    /** 지우지 않은 참여작의 작성자와 챌린지. */
    @Query("""
            select new com.acttub.actingapi.feature.challenge.adapter.db.ChallengeEntryJpaRepository$Parent(e.userId, e.challengeId)
            from ChallengeEntryEntity e where e.id = :id and e.status <> DELETED
            """)
    Optional<Parent> findLive(UUID id);

    /** 참여작 행을 쓰기로 잡는다. 방언 덕에 {@code for update} 로 나간다(§5-2). */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("""
            select new com.acttub.actingapi.feature.challenge.adapter.db.ChallengeEntryJpaRepository$Content(e.contentVersion, e.caption)
            from ChallengeEntryEntity e where e.id = :id
            """)
    Optional<Content> lockForWrite(UUID id);

    /** 참여작 행을 읽기로 잡는다({@code for share}). 읽기끼리는 함께 쥐고, 고치려는 쪽은 기다린다. */
    @Lock(LockModeType.PESSIMISTIC_READ)
    @Query("""
            select new com.acttub.actingapi.feature.challenge.adapter.db.ChallengeEntryJpaRepository$Content(e.contentVersion, e.caption)
            from ChallengeEntryEntity e where e.id = :id
            """)
    Optional<Content> lockForRead(UUID id);

    /** 그 회원의 지우지 않은 참여작이면 그 id. */
    @Query("select e.id from ChallengeEntryEntity e where e.id = :id and e.userId = :userId and e.status <> DELETED")
    Optional<UUID> findLiveOwnedBy(UUID id, UUID userId);
}
