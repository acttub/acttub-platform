package com.acttub.actingapi.feature.challenge.adapter.db;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.challenge.schema.ChallengeEntity;
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
}
