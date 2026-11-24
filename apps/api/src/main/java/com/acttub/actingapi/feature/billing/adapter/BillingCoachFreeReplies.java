package com.acttub.actingapi.feature.billing.adapter;

import com.acttub.actingapi.feature.billing.app.SubscriptionService;
import com.acttub.actingapi.feature.coach.app.CoachFreeReplies;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * 무료 코칭 한 번의 배우 답 상한(SOMA-1131). 무료 한도가 걸리는 회원({@link SubscriptionService#freeLimited} — 한도 설정 켜짐,
 * Pro 아님, 기존 회원 유예 아님)에게만 {@code COACHING_FREE_REPLY_LIMIT}(기본 7)을 준다. 0 이하로 두면 상한을 끈다.
 */
@Component
class BillingCoachFreeReplies implements CoachFreeReplies {
    private final SubscriptionService subscriptions;
    private final int limit;

    BillingCoachFreeReplies(SubscriptionService subscriptions,
            @Value("${COACHING_FREE_REPLY_LIMIT:7}") int limit) {
        this.subscriptions = subscriptions;
        this.limit = limit;
    }

    @Override
    public int actorReplies(UUID userId) {
        if (limit <= 0 || userId == null) return 0;
        return subscriptions.freeLimited(userId) ? limit : 0;
    }
}
