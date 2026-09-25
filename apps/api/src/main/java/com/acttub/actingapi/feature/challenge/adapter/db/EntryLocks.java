package com.acttub.actingapi.feature.challenge.adapter.db;

import java.time.Instant;
import java.util.UUID;
import com.acttub.actingapi.platform.persistence.NativeTuples;
import com.acttub.actingapi.platform.web.ApiException;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Tuple;
import org.springframework.stereotype.Component;

/**
 * 반응·신고의 잠금 순서: 사람(users, id 순) → 챌린지(마감 집계) → 참여작. 참여작 수정·삭제도 사용자 → 챌린지 → 참여작
 * 순서라 서로 기다려도 원을 만들지 않는다. 차단 켜기는 두 사람 행을 같은 순서로 잠그므로 반응과 차단이 겹치면
 * 먼저 잡은 쪽이 끝난 뒤 다른 쪽이 조건을 다시 본다. 부르는 쪽의 트랜잭션에 참여한다.
 */
@Component
class EntryLocks {
    record Target(UUID author, UUID challengeId, int contentVersion, String caption) { }

    private final EntityManager em;
    private final ChallengeSettlement settlement;
    EntryLocks(EntityManager em, ChallengeSettlement settlement) { this.em = em; this.settlement = settlement; }

    /**
     * 행동하는 사람은 쓰기로, 상대는 읽기로 잠근다(같은 사람이면 한 번). 행동하는 사람이 활성이 아니면 403, 상대가
     * 없으면 {@code false}.
     */
    boolean people(UUID actor, UUID other, boolean otherExclusive) {
        UUID first = actor.compareTo(other) <= 0 ? actor : other;
        UUID second = first.equals(actor) ? other : actor;
        boolean found = true;
        for (UUID id : first.equals(second) ? new UUID[]{first} : new UUID[]{first, second}) {
            boolean exclusive = id.equals(actor) || otherExclusive;
            var rows = NativeTuples.list(em.createNativeQuery(
                    "SELECT status FROM users WHERE id=:id " + (exclusive ? "FOR UPDATE" : "FOR SHARE"), Tuple.class)
                    .setParameter("id", id));
            if (id.equals(actor) && (rows.isEmpty() || !"active".equals(rows.getFirst().get("status", String.class)))) {
                throw new ApiException(403, "account_deactivated");
            }
            if (!id.equals(actor) && rows.isEmpty()) found = false;
        }
        return found;
    }

    /**
     * 참여작을 잠그고 보는 사람에게 보이는지 다시 본다. 마감 뒤 첫 변경이면 쓰기 전에 마감 집계를 한다.
     *
     * @param ownAllowed 본인 참여작이면 공개 조건 없이 통과(댓글 목록·쓰기)
     */
    Target entry(UUID viewer, UUID entryId, Instant now, boolean exclusive, boolean ownAllowed) {
        var found = NativeTuples.list(em.createNativeQuery(
                "SELECT user_id,challenge_id FROM challenge_entries WHERE id=:id AND status<>'deleted'", Tuple.class)
                .setParameter("id", entryId));
        if (found.isEmpty()) throw new ApiException(404, "entry_not_found");
        UUID author = found.getFirst().get("user_id", UUID.class);
        UUID challenge = found.getFirst().get("challenge_id", UUID.class);
        people(viewer, author, false);
        settlement.aggregateIfDue(challenge, now);
        var locked = NativeTuples.list(em.createNativeQuery("SELECT content_version,caption FROM challenge_entries WHERE id=:id "
                + (exclusive ? "FOR UPDATE" : "FOR SHARE"), Tuple.class).setParameter("id", entryId)).getFirst();
        if (!visible(viewer, entryId, ownAllowed)) throw new ApiException(404, "entry_not_found");
        return new Target(author, challenge, ((Number) locked.get("content_version")).intValue(), locked.get("caption", String.class));
    }

    /** 개인 노출 조건(또는 본인의 삭제되지 않은 참여작). */
    boolean visible(UUID viewer, UUID entryId, boolean ownAllowed) {
        return !NativeTuples.list(em.createNativeQuery("SELECT e.id " + ChallengeVisibility.ENTRY_FROM + " WHERE e.id=:id AND "
                + ChallengeVisibility.PUBLIC_ENTRY + " AND " + ChallengeVisibility.UNBLOCKED, Tuple.class)
                .setParameter("id", entryId).setParameter("viewer", viewer)).isEmpty()
                || ownAllowed && !NativeTuples.list(em.createNativeQuery(
                        "SELECT id FROM challenge_entries WHERE id=:id AND user_id=:viewer AND status<>'deleted'", Tuple.class)
                        .setParameter("id", entryId).setParameter("viewer", viewer)).isEmpty();
    }
}
