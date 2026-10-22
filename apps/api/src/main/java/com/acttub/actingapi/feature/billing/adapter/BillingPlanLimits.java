package com.acttub.actingapi.feature.billing.adapter;

import java.util.UUID;

import com.acttub.actingapi.feature.billing.app.SubscriptionService;
import com.acttub.actingapi.feature.practice.app.CoachingPlan;
import com.acttub.actingapi.feature.reading.app.ScriptPlan;
import org.springframework.stereotype.Component;

/**
 * 무료 한도가 걸리는가(SOMA-818) — 코칭(하루 1회차)과 리딩 대본(1개). 결제 기능이 열려 있고
 * {@code BILLING_FREE_LIMITS_ENABLED=true} 이고 Pro 가 아닐 때만 true 다. 플래그가 꺼져 있으면 DB 를 읽지 않는다.
 */
@Component
class BillingPlanLimits implements CoachingPlan, ScriptPlan {
    private final SubscriptionService subscriptions;

    BillingPlanLimits(SubscriptionService subscriptions) {
        this.subscriptions = subscriptions;
    }

    @Override
    public boolean freeLimited(UUID userId) {
        return subscriptions.settings().limitsEnforced() && !subscriptions.pro(userId);
    }
}
