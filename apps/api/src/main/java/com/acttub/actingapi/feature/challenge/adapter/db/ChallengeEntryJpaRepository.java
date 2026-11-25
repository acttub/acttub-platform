package com.acttub.actingapi.feature.challenge.adapter.db;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import com.acttub.actingapi.feature.challenge.schema.ChallengeEntryEntity;
import com.acttub.actingapi.platform.schema.ChallengeEntryStatus;
import jakarta.persistence.LockModeType;
import jakarta.persistence.QueryHint;
import org.springframework.data.domain.Limit;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.jpa.repository.QueryHints;
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

    @Query("select e.challengeId from ChallengeEntryEntity e where e.id = :id")
    Optional<UUID> findChallengeId(UUID id);

    @Query("""
            select new com.acttub.actingapi.feature.challenge.adapter.db.ChallengeEntryJpaRepository$Content(e.contentVersion, e.caption)
            from ChallengeEntryEntity e where e.id = :id
            """)
    Optional<Content> findContent(UUID id);

    /** 신고·AI 판정이 보이던 참여작을 숨긴다. 이미 숨겨졌거나 지운 것은 0행이다. */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("update ChallengeEntryEntity e set e.status = HIDDEN_BY_REPORT, e.updatedAt = :now where e.id = :id and e.status = VISIBLE")
    int hideByReport(UUID id, Instant now);

    // ---- 공개 참여작 AI 검사 ----

    record ModerationState(String moderationStatus, int moderationAttempts, int contentVersion, String caption,
            ChallengeEntryStatus status) { }

    /**
     * 검사 시도 수가 상한에 닿은 채 차례에 남은 참여작을 만든 순으로 잡는다. 다른 트랜잭션이 잡은 행은 기다리지 않고
     * 건너뛴다({@code for update … skip locked} — {@code lock.timeout=-2}).
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @QueryHints(@QueryHint(name = "jakarta.persistence.lock.timeout", value = "-2"))
    @Query("""
            select e.id from ChallengeEntryEntity e
            where e.moderationStatus = 'pending' and e.moderationAttempts >= :maxAttempts and e.status <> DELETED
            order by e.createdAt, e.id
            """)
    List<UUID> lockExhaustedModeration(int maxAttempts, Limit limit);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("""
            select new com.acttub.actingapi.feature.challenge.adapter.db.ChallengeEntryJpaRepository$ModerationState(
                e.moderationStatus, e.moderationAttempts, e.contentVersion, e.caption, e.status)
            from ChallengeEntryEntity e where e.id = :id
            """)
    Optional<ModerationState> lockModeration(UUID id);

    /** 판정을 붙인다. 얼굴 여부는 {@code face} 가 null 이면 이미 아는 값을 그대로 둔다. */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            update ChallengeEntryEntity e
            set e.moderationStatus = :status, e.moderationModel = :model, e.moderatedAt = :now,
                e.faceVisible = coalesce(:face, e.faceVisible)
            where e.id = :id
            """)
    int judge(UUID id, String status, String model, Instant now, Boolean face);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("update ChallengeEntryEntity e set e.moderationStatus = 'failed', e.moderatedAt = :now where e.id = :id")
    int failModeration(UUID id, Instant now);

    /** 얼굴 여부를 모를 때만 적는다. */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("update ChallengeEntryEntity e set e.faceVisible = :face where e.id = :id and e.faceVisible is null")
    int fillFace(UUID id, boolean face);
}
