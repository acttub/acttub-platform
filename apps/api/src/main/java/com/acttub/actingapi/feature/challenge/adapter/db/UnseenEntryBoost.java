package com.acttub.actingapi.feature.challenge.adapter.db;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.UUID;
import com.acttub.actingapi.platform.persistence.NativeTuples;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Tuple;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * 진행 중 챌린지의 좋아요순에서, 아직 남이 거의 보지 않은 공개 참여작을 앞쪽 몇 칸(3·6·9번째…)에 끼워 넣는다.
 * 좋아요 0인 새 참여작은 좋아요순 맨 끝(그중에서도 오래된 것부터)에 놓여 아무도 보지 않은 채 묻히기 때문이다(SOMA-957).
 * 끼운 칸에는 순위 숫자를 주지 않는다(0). 다른 참여작의 순위 숫자는 전체 기준 그대로다.
 * 고르는 기준: 앞쪽 칸 범위 밖에 있고, 보는 사람 본인 것이 아니고, 남의 조회(view_count)가 기준 미만이고, 보는 사람이 최근 7일 안에
 * 본 적이 없고, 서로 차단이 없는 참여작 중 가장 최근에 공개된 것부터.
 */
@Component
class UnseenEntryBoost {
    /** 끼우는 간격: 3번째, 6번째, 9번째 칸. */
    static final int GAP = 3;

    private final EntityManager em;
    private final int slots;
    private final int maxViews;

    UnseenEntryBoost(EntityManager em,
                     @Value("${CHALLENGE_UNSEEN_BOOST_SLOTS:3}") int slots,
                     @Value("${CHALLENGE_UNSEEN_BOOST_MAX_VIEWS:5}") int maxViews) {
        this.em = em;
        this.slots = Math.max(0, slots);
        this.maxViews = Math.max(0, maxViews);
    }

    /** 끼운 결과. order와 ranks는 같은 길이다. */
    record Boosted(List<UUID> order, List<Integer> ranks) {}

    Boosted apply(UUID viewer, List<UUID> order, List<Integer> ranks) {
        int window = slots * GAP;
        if (slots == 0 || maxViews == 0 || order.size() <= window) return new Boosted(order, ranks);
        List<UUID> beyond = order.subList(window, order.size());
        List<UUID> picked = NativeTuples.list(em.createNativeQuery("SELECT e.id " + ChallengeVisibility.ENTRY_FROM
                        + " WHERE e.id IN (:ids) AND e.user_id<>:viewer AND e.view_count<:maxViews AND " + ChallengeVisibility.UNBLOCKED
                        + " AND NOT EXISTS (SELECT 1 FROM entry_view_events seen WHERE seen.entry_id=e.id AND seen.user_id=:viewer)"
                        + " ORDER BY e.published_at DESC,e.id DESC", Tuple.class)
                .setParameter("ids", beyond).setParameter("viewer", viewer).setParameter("maxViews", maxViews)
                .setMaxResults(slots)).stream().map(row -> row.get("id", UUID.class)).toList();
        if (picked.isEmpty()) return new Boosted(order, ranks);
        var moved = new HashSet<>(picked);
        var restOrder = new ArrayList<UUID>(order.size());
        var restRanks = new ArrayList<Integer>(order.size());
        for (int i = 0; i < order.size(); i++) {
            if (moved.contains(order.get(i))) continue;
            restOrder.add(order.get(i));
            restRanks.add(ranks.get(i));
        }
        for (int k = 0; k < picked.size(); k++) {
            int at = Math.min(k * GAP + GAP - 1, restOrder.size());
            restOrder.add(at, picked.get(k));
            restRanks.add(at, 0);
        }
        return new Boosted(List.copyOf(restOrder), List.copyOf(restRanks));
    }
}
