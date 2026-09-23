package com.acttub.actingapi.feature.challenge.adapter.db;

import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;
import com.acttub.actingapi.platform.persistence.NativeTuples;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Tuple;
import org.springframework.stereotype.Component;

/**
 * 종료 랭킹 (challenge.browse). 마감 뒤 첫 변경이나 매시 도는 일이 챌린지 행을 잠그고 마감 집계를 한 번 한다 —
 * 삭제되지 않은 참여작마다 그 시점 좋아요 수와 참가 자격을 저장한다. 순위는 확인 중인 참여작과 review 챌린지가
 * 없을 때 한 번에 매긴다(pending → final). 부르는 쪽의 트랜잭션에 참여한다.
 */
@Component
class ChallengeSettlement {
    /**
     * 순위 확정을 기다리게 하는 참여작. 마감 당시 자격이 있었고 지금 신고로 숨겨져 있다. 참가 자격은 신고 숨김을
     * 통과로 셈해 두고(되돌리면 그 자리에서 순위에 든다), 확정은 남은 숨김이 없을 때 한다.
     */
    static final String UNDER_REVIEW = "e.status='hidden_by_report' AND e.final_eligible";
    private final EntityManager em;
    ChallengeSettlement(EntityManager em) { this.em = em; }

    /** 챌린지 행을 잠근 뒤 마감이 지났고 아직 집계 전이면 집계하고, 집계 중이면 확정을 시도한다. */
    void settle(UUID challengeId, Instant now) {
        var rows = NativeTuples.list(em.createNativeQuery(
                "SELECT ends_at,ranking_state FROM challenges WHERE id=:id FOR UPDATE", Tuple.class).setParameter("id", challengeId));
        if (rows.isEmpty()) return;
        String state = rows.getFirst().get("ranking_state", String.class);
        if (state == null && !now.isBefore(rows.getFirst().get("ends_at", Instant.class))) {
            aggregate(challengeId, now);
            state = "pending";
        }
        if ("pending".equals(state)) confirm(challengeId, now);
    }

    /** 집계 전이면 잠그고 집계만 한다(읽기가 부른다 — 확정 시도는 변경·운영 처리·매시 일이 한다). */
    void aggregateIfDue(UUID challengeId, Instant now) {
        var due = NativeTuples.list(em.createNativeQuery(
                "SELECT 1 AS due FROM challenges WHERE id=:id AND ranking_state IS NULL AND ends_at<=:now", Tuple.class)
                .setParameter("id", challengeId).setParameter("now", now.atOffset(ZoneOffset.UTC)));
        if (!due.isEmpty()) settle(challengeId, now);
    }

    /** 매시 도는 일의 대상 — 집계가 밀렸거나 확정을 기다리는 챌린지. */
    List<UUID> waiting(Instant now) {
        return NativeTuples.list(em.createNativeQuery("""
                SELECT id FROM challenges
                WHERE (ranking_state IS NULL AND ends_at<=:now) OR ranking_state='pending'
                ORDER BY ends_at LIMIT 200
                """, Tuple.class).setParameter("now", now.atOffset(ZoneOffset.UTC)))
                .stream().map(row -> row.get("id", UUID.class)).toList();
    }

    private void aggregate(UUID challengeId, Instant now) {
        em.createNativeQuery("""
                UPDATE challenge_entries e
                SET final_like_count=(SELECT count(*) FROM entry_likes l WHERE l.entry_id=e.id),
                    final_eligible=(e.visibility='public' AND e.status IN ('visible','hidden_by_report')
                        AND EXISTS(SELECT 1 FROM users u WHERE u.id=e.user_id AND u.status='active')
                        AND EXISTS(SELECT 1 FROM videos v WHERE v.id=e.video_id AND v.purged_at IS NULL)),
                    updated_at=:now
                WHERE e.challenge_id=:id AND e.status<>'deleted'
                """).setParameter("id", challengeId).setParameter("now", now.atOffset(ZoneOffset.UTC)).executeUpdate();
        em.createNativeQuery("UPDATE challenges SET ranking_state='pending' WHERE id=:id")
                .setParameter("id", challengeId).executeUpdate();
    }

    private void confirm(UUID challengeId, Instant now) {
        var blocked = NativeTuples.list(em.createNativeQuery("""
                SELECT 1 AS waiting FROM challenges c WHERE c.id=:id AND (c.moderation='review'
                  OR EXISTS(SELECT 1 FROM challenge_entries e WHERE e.challenge_id=c.id AND %s))
                """.formatted(UNDER_REVIEW), Tuple.class).setParameter("id", challengeId));
        if (!blocked.isEmpty()) return;
        em.createNativeQuery("""
                UPDATE challenge_entries e SET final_rank=ranked.position,updated_at=:now
                FROM (SELECT id,rank() OVER (ORDER BY final_like_count DESC) AS position
                      FROM challenge_entries WHERE challenge_id=:id AND final_eligible AND status='visible') ranked
                WHERE e.id=ranked.id
                """).setParameter("id", challengeId).setParameter("now", now.atOffset(ZoneOffset.UTC)).executeUpdate();
        em.createNativeQuery("UPDATE challenges SET ranking_state='final',finalized_at=:now WHERE id=:id")
                .setParameter("id", challengeId).setParameter("now", now.atOffset(ZoneOffset.UTC)).executeUpdate();
    }
}
