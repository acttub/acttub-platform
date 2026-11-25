package com.acttub.actingapi.feature.challenge.adapter.db;

import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;
import com.acttub.actingapi.platform.persistence.NativeTuples;
import com.acttub.actingapi.platform.schema.ChallengeRankingState;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Tuple;
import org.springframework.data.domain.Limit;
import org.springframework.stereotype.Component;

/**
 * 종료 랭킹 (challenge.browse). 마감 뒤 첫 변경이나 매시 도는 일이 챌린지 행을 잠그고 마감 집계를 한 번 한다 —
 * 삭제되지 않은 참여작마다 그 시점 좋아요 수와 참가 자격을 저장한다. 순위는 확인 중인 참여작과 review 챌린지가
 * 없을 때 한 번에 매긴다(pending → final). 부르는 쪽의 트랜잭션에 참여한다.
 */
@Component
class ChallengeSettlement {
    private final EntityManager em;
    private final ChallengeJpaRepository challenges;
    private final NotificationEvents events;
    ChallengeSettlement(EntityManager em, ChallengeJpaRepository challenges, NotificationEvents events) {
        this.em = em; this.challenges = challenges; this.events = events;
    }

    /** 챌린지 행을 잠근 뒤 마감이 지났고 아직 집계 전이면 집계하고, 집계 중이면 확정을 시도한다. */
    void settle(UUID challengeId, Instant now) {
        var locked = challenges.lockDeadline(challengeId);
        if (locked.isEmpty()) return;
        ChallengeRankingState state = locked.get().rankingState();
        if (state == null && !now.isBefore(locked.get().endsAt())) {
            aggregate(challengeId, now);
            state = ChallengeRankingState.PENDING;
        }
        if (state == ChallengeRankingState.PENDING) confirm(challengeId, now);
    }

    /** 집계 전이면 잠그고 집계만 한다(읽기가 부른다 — 확정 시도는 변경·운영 처리·매시 일이 한다). */
    void aggregateIfDue(UUID challengeId, Instant now) {
        if (challenges.dueForAggregation(challengeId, now).isPresent()) settle(challengeId, now);
    }

    /** 매시 도는 일의 대상 — 집계가 밀렸거나 확정을 기다리는 챌린지. */
    List<UUID> waiting(Instant now) {
        return challenges.waitingForSettlement(now, Limit.of(200));
    }

    private void aggregate(UUID challengeId, Instant now) {
        em.createNativeQuery("""
                UPDATE challenge_entries e
                SET final_like_count=(SELECT count(*) FROM entry_likes l WHERE l.entry_id=e.id),
                    final_eligible=(e.visibility='public' AND e.status IN ('visible','hidden_by_report')
                        AND (NOT e.face_mosaic OR e.mosaic_status='ready')
                        AND EXISTS(SELECT 1 FROM users u WHERE u.id=e.user_id AND u.status='active')
                        AND EXISTS(SELECT 1 FROM videos v WHERE v.id=e.video_id AND v.purged_at IS NULL)),
                    updated_at=:now
                WHERE e.challenge_id=:id AND e.status<>'deleted'
                """).setParameter("id", challengeId).setParameter("now", now.atOffset(ZoneOffset.UTC)).executeUpdate();
        challenges.markAggregated(challengeId);
        // 삭제되지 않은 참여작을 가진 사람마다 종료 알림 하나(챌린지당 한 번, 참여작이 여럿이어도 하나).
        NativeTuples.list(em.createNativeQuery("""
                SELECT DISTINCT e.user_id FROM challenge_entries e JOIN users u ON u.id=e.user_id
                WHERE e.challenge_id=:id AND e.status<>'deleted' AND u.status='active'
                """, Tuple.class).setParameter("id", challengeId)).forEach(row -> events.record(row.get("user_id", UUID.class),
                "challenge_ended", null, challengeId, null, null, "ended:" + challengeId, now));
    }

    private void confirm(UUID challengeId, Instant now) {
        if (challenges.confirmationBlocked(challengeId).isPresent()) return;
        em.createNativeQuery("""
                UPDATE challenge_entries e SET final_rank=ranked.position,updated_at=:now
                FROM (SELECT id,rank() OVER (ORDER BY final_like_count DESC) AS position
                      FROM challenge_entries WHERE challenge_id=:id AND final_eligible AND status='visible') ranked
                WHERE e.id=ranked.id
                """).setParameter("id", challengeId).setParameter("now", now.atOffset(ZoneOffset.UTC)).executeUpdate();
        challenges.markFinal(challengeId, now);
    }
}
