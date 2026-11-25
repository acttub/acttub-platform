package com.acttub.actingapi.feature.challenge.adapter.db;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import com.acttub.actingapi.feature.challenge.schema.ChallengeEntity;
import com.acttub.actingapi.platform.schema.ChallengeModeration;
import com.acttub.actingapi.platform.schema.ChallengeRankingState;
import jakarta.persistence.LockModeType;
import org.springframework.data.domain.Limit;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;

/** {@code challenges} 를 읽고 쓰는 문장(apps/api/CONTRACT.md §5-9). */
interface ChallengeJpaRepository extends Repository<ChallengeEntity, UUID> {

    /** 운영 개설을 줄 세우는 권고 잠금. 트랜잭션이 끝나면 풀린다. */
    @Query("select pg_advisory_xact_lock(hashtext('challenge_team_create'))")
    Object lockTeamCreation();

    /** 마감이 지났고 아직 집계 전이며 그 회원의 지우지 않은 참여작이 있는 챌린지. 잠그는 순서가 되므로 id 순이다. */
    @Query("""
            select distinct c.id from ChallengeEntity c join ChallengeEntryEntity e on e.challengeId = c.id
            where e.userId = :userId and e.status <> DELETED and c.rankingState is null and c.endsAt <= :now
            order by c.id
            """)
    List<UUID> dueWithEntryOf(UUID userId, Instant now);

    /** 마감과 순위 상태. */
    record Deadline(Instant endsAt, ChallengeRankingState rankingState) { }

    /** 챌린지 행을 잡는다. 방언 덕에 {@code for update} 로 나간다(§5-2). */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("""
            select new com.acttub.actingapi.feature.challenge.adapter.db.ChallengeJpaRepository$Deadline(c.endsAt, c.rankingState)
            from ChallengeEntity c where c.id = :id
            """)
    Optional<Deadline> lockDeadline(UUID id);

    /** 마감이 지났고 아직 집계 전이면 한 행. 잠그지 않는다. */
    @Query("select 1 from ChallengeEntity c where c.id = :id and c.rankingState is null and c.endsAt <= :now")
    Optional<Integer> dueForAggregation(UUID id, Instant now);

    /** 집계가 밀렸거나 확정을 기다리는 챌린지, 마감 순. */
    @Query("""
            select c.id from ChallengeEntity c
            where (c.rankingState is null and c.endsAt <= :now) or c.rankingState = PENDING
            order by c.endsAt
            """)
    List<UUID> waitingForSettlement(Instant now, Limit limit);

    /**
     * 순위 확정을 미루는가 — 챌린지가 review 이거나, 마감 당시 자격이 있었고 지금 신고로 숨겨져 처리되지 않은 신고가 남은
     * 참여작이 있다. 숨김 유지(kept_hidden)로 끝난 것은 미루지 않는다.
     */
    @Query("""
            select 1 from ChallengeEntity c
            where c.id = :id and (c.moderation = REVIEW or exists (
                select 1 from ChallengeEntryEntity e
                where e.challengeId = c.id and e.status = HIDDEN_BY_REPORT and e.finalEligible = true and exists (
                    select 1 from EntryReportEntity r
                    where r.targetType = ENTRY and r.targetId = e.id and r.status = RECEIVED)))
            """)
    Optional<Integer> confirmationBlocked(UUID id);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("update ChallengeEntity c set c.rankingState = PENDING where c.id = :id")
    int markAggregated(UUID id);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("update ChallengeEntity c set c.rankingState = FINAL, c.finalizedAt = :now where c.id = :id")
    int markFinal(UUID id, Instant now);

    // ---- 신고 ----

    record Reportable(UUID hostUserId, String line) { }

    /** 지금 보이는(지우지 않았고 visible 이며 시작한) 챌린지 행을 잡는다. */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("""
            select new com.acttub.actingapi.feature.challenge.adapter.db.ChallengeJpaRepository$Reportable(c.hostUserId, c.line)
            from ChallengeEntity c
            where c.id = :id and c.deletedAt is null and c.moderation = VISIBLE and c.startsAt <= :now
            """)
    Optional<Reportable> lockReportable(UUID id, Instant now);

    /** 챌린지 행을 쓰기로 잡기만 한다. */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select c.id from ChallengeEntity c where c.id = :id")
    Optional<UUID> lockRow(UUID id);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("update ChallengeEntity c set c.moderation = REVIEW where c.id = :id")
    int sendToReview(UUID id);

    /** 운영이 신고를 풀었다 — 검토로 올라간 챌린지만 다시 보인다. */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("update ChallengeEntity c set c.moderation = VISIBLE where c.id = :id and c.moderation = REVIEW")
    int releaseFromReview(UUID id);

    // ---- 참여작 올리기·고치기 ----

    /** 참여작을 받을 수 있는지 정하는 값. */
    record Window(ChallengeModeration moderation, Instant deletedAt, Instant startsAt, Instant endsAt) { }

    /** 챌린지 행을 잡고 참여 조건을 읽는다 — 올리기가 정산·운영자 조치·지우기와 여기서 줄을 선다. */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("""
            select new com.acttub.actingapi.feature.challenge.adapter.db.ChallengeJpaRepository$Window(c.moderation, c.deletedAt, c.startsAt, c.endsAt)
            from ChallengeEntity c where c.id = :id
            """)
    Optional<Window> lockWindow(UUID id);

    @Query("""
            select new com.acttub.actingapi.feature.challenge.adapter.db.ChallengeJpaRepository$Window(c.moderation, c.deletedAt, c.startsAt, c.endsAt)
            from ChallengeEntity c where c.id = :id
            """)
    Optional<Window> findWindow(UUID id);
}
