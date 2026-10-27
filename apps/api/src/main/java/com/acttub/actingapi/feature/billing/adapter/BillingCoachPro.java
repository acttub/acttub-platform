package com.acttub.actingapi.feature.billing.adapter;

import com.acttub.actingapi.feature.billing.app.SubscriptionService;
import com.acttub.actingapi.feature.coach.app.CoachPro;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * 코치가 묻는 「Pro 인가」(SOMA-900). 결제 구독과 서버가 준 Pro 기간을 모두 Pro 로 본다(SubscriptionService.pro).
 *
 * <p>스위치 {@code ACTTUB_COACH_PRO}: 값을 주지 않으면 dev 에서만 켜지고 운영은 꺼진다. 운영은 11/1 결제 오픈 때 사용자 승인 뒤
 * 운영 env 에 true 를 넣어 켠다. false 면 모두 무료 코칭(롤백).
 */
@Component
class BillingCoachPro implements CoachPro {
    private final SubscriptionService subscriptions;
    private final boolean enabled;

    BillingCoachPro(SubscriptionService subscriptions,
            @Value("${ACTTUB_COACH_PRO:}") String configured,
            @Value("${SITE_URL:}") String siteUrl) {
        this.subscriptions = subscriptions;
        this.enabled = enabled(configured, siteUrl);
    }

    static boolean enabled(String configured, String siteUrl) {
        if (configured != null && !configured.isBlank()) return Boolean.parseBoolean(configured.strip());
        return "https://dev.acttub.com".equals(siteUrl);
    }

    @Override
    public boolean pro(UUID userId) {
        return enabled && userId != null && subscriptions.pro(userId);
    }
}
