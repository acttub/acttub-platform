package com.acttub.actingapi.feature.challenge.adapter.db;

import java.time.Instant;
import java.util.UUID;
import com.acttub.actingapi.feature.auth.app.AccountRowLock;
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
    private final ChallengeEntryJpaRepository entries;
    private final ChallengeSettlement settlement;
    private final AccountRowLock accountRows;

    EntryLocks(EntityManager em, ChallengeEntryJpaRepository entries, ChallengeSettlement settlement, AccountRowLock accountRows) {
        this.accountRows = accountRows;
        this.em = em; this.entries = entries; this.settlement = settlement;
    }

    /** 쓰는 사람 하나를 쓰기로 잠근다(챌린지 만들기·참여작 쓰기). 활성이 아니면 403. */
    void active(UUID owner) {
        if (!accountRows.lockActive(owner)) {
            throw new ApiException(403, "account_deactivated");
        }
    }

    /**
     * 행동하는 사람은 쓰기로, 상대는 읽기로 잠근다(같은 사람이면 한 번). 행동하는 사람이 활성이 아니면 403, 상대가
     * 없으면 {@code false}.
     */
    boolean people(UUID actor, UUID other, boolean otherExclusive) {
        UUID first = actor.compareTo(other) <= 0 ? actor : other;
        UUID second = first.equals(actor) ? other : actor;
        boolean found = true;
        for (UUID id : first.equals(second) ? new UUID[]{first} : new UUID[]{first, second}) {
            if (id.equals(actor)) {
                if (!accountRows.lockActive(id)) {
                    throw new ApiException(403, "account_deactivated");
                }
            } else if (!(otherExclusive ? accountRows.lockRow(id) : accountRows.lockShared(id))) {
                found = false;
            }
        }
        return found;
    }

    /**
     * 참여작을 잠그고 보는 사람에게 보이는지 다시 본다. 마감 뒤 첫 변경이면 쓰기 전에 마감 집계를 한다.
     *
     * @param ownAllowed 본인 참여작이면 공개 조건 없이 통과(댓글 목록·쓰기)
     */
    Target entry(UUID viewer, UUID entryId, Instant now, boolean exclusive, boolean ownAllowed) {
        var found = entries.findLive(entryId).orElseThrow(() -> new ApiException(404, "entry_not_found"));
        people(viewer, found.userId(), false);
        settlement.aggregateIfDue(found.challengeId(), now);
        var locked = (exclusive ? entries.lockForWrite(entryId) : entries.lockForRead(entryId)).orElseThrow();
        if (!visible(viewer, entryId, ownAllowed)) throw new ApiException(404, "entry_not_found");
        return new Target(found.userId(), found.challengeId(), locked.contentVersion(), locked.caption());
    }

    /** 개인 노출 조건(또는 본인의 삭제되지 않은 참여작). */
    boolean visible(UUID viewer, UUID entryId, boolean ownAllowed) {
        return !NativeTuples.list(em.createNativeQuery("SELECT e.id " + ChallengeVisibility.ENTRY_FROM + " WHERE e.id=:id AND "
                + ChallengeVisibility.PUBLIC_ENTRY + " AND " + ChallengeVisibility.UNBLOCKED, Tuple.class)
                .setParameter("id", entryId).setParameter("viewer", viewer)).isEmpty()
                || ownAllowed && entries.findLiveOwnedBy(entryId, viewer).isPresent();
    }
}
