package com.acttub.actingapi.feature.billing.adapter;

import java.util.UUID;

import com.acttub.actingapi.feature.ads.app.ProStatusReader;
import com.acttub.actingapi.feature.billing.app.SubscriptionService;
import org.springframework.stereotype.Component;

/**
 * 광고 칸이 묻는 「Pro 인가」(SOMA-876). 결제 기능이 꺼져 있으면 SubscriptionService 가 false 를 내므로 모두 무료로 본다.
 * 한도 강제 플래그와는 상관없다 — 광고는 Pro 구독 자체만 본다.
 */
@Component
class BillingAdProStatus implements ProStatusReader {
    private final SubscriptionService subscriptions;

    BillingAdProStatus(SubscriptionService subscriptions) {
        this.subscriptions = subscriptions;
    }

    @Override
    public boolean pro(UUID userId) {
        return subscriptions.pro(userId);
    }
}
